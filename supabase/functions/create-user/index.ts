import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

type Body = {
  email: string;
  tempPassword: string;
  role: "hr" | "regional_manager" | "district_manager" | "manager" | "employee";
  storeId?: string | null;
  districtId?: string | null;
  regionId?: string | null;
  employeeId?: string | null;
};

serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
  if (!token) return new Response("Unauthorized", { status: 401 });

  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !userData.user) return new Response("Unauthorized", { status: 401 });

  const { data: profile, error: profErr } = await supabase
    .from("profiles")
    .select("role")
    .eq("user_id", userData.user.id)
    .maybeSingle();

  if (profErr) return new Response("Profile error", { status: 500 });
  if (!profile || profile.role !== "hr") return new Response("Forbidden", { status: 403 });

  const body = (await req.json()) as Body;

  const email = (body.email ?? "").trim().toLowerCase();
  const tempPassword = body.tempPassword ?? "";
  const role = body.role;

  if (!email) return new Response("Email required", { status: 400 });
  if (!tempPassword || tempPassword.length < 8) return new Response("Temp password must be at least 8 chars", { status: 400 });
  if (!role) return new Response("Role required", { status: 400 });

  const { data: created, error: createErr } = await supabase.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
  });

  if (createErr || !created.user) return new Response(createErr?.message ?? "Create user failed", { status: 400 });

  const { error: insertErr } = await supabase.from("profiles").insert({
    user_id: created.user.id,
    role,
    store_id: body.storeId ?? null,
    district_id: body.districtId ?? null,
    region_id: body.regionId ?? null,
    employee_id: body.employeeId ?? null,
    must_change_password: true,
  });

  if (insertErr) return new Response(insertErr.message, { status: 400 });

  return new Response(JSON.stringify({ ok: true, userId: created.user.id }), {
    headers: { "Content-Type": "application/json" },
  });
});
// Deno edge function
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Role = "manager" | "hr" | "district_manager" | "regional_manager" | "employee";

Deno.serve(async (req) => {
  try {
    const authHeader = req.headers.get("Authorization") ?? "";

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const admin = createClient(supabaseUrl, serviceKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Identify caller from JWT
    const { data: callerData, error: callerErr } = await admin.auth.getUser();
    if (callerErr || !callerData.user) {
      return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), { status: 401 });
    }

    const callerId = callerData.user.id;

    // Check caller is HR
    const { data: callerProfile } = await admin
      .from("profiles")
      .select("role")
      .eq("user_id", callerId)
      .maybeSingle();

    if (!callerProfile || callerProfile.role !== "hr") {
      return new Response(JSON.stringify({ ok: false, error: "Forbidden" }), { status: 403 });
    }

    const body = await req.json();
    const email = String(body.email ?? "").trim().toLowerCase();
    const tempPassword = String(body.tempPassword ?? "");
    const role = body.role as Role;
    const storeId = body.storeId ? String(body.storeId) : null;

    if (!email) return new Response(JSON.stringify({ ok: false, error: "Email required" }), { status: 400 });
    if (!tempPassword || tempPassword.length < 8)
      return new Response(JSON.stringify({ ok: false, error: "Temp password must be 8+ chars" }), { status: 400 });

    // Create Auth user (or fetch existing)
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
    });

    if (createErr && !String(createErr.message).includes("already registered")) {
      return new Response(JSON.stringify({ ok: false, error: createErr.message }), { status: 400 });
    }

    const userId = created?.user?.id;

    // If already exists, look it up
    let finalUserId = userId;
    if (!finalUserId) {
      const { data: byEmail } = await admin.auth.admin.listUsers({ page: 1, perPage: 2000 });
      const found = byEmail?.users?.find((u) => (u.email ?? "").toLowerCase() === email);
      finalUserId = found?.id;
    }

    if (!finalUserId) {
      return new Response(JSON.stringify({ ok: false, error: "Could not resolve user id" }), { status: 500 });
    }

    // Upsert profile
    const { error: upErr } = await admin.from("profiles").upsert(
      {
        user_id: finalUserId,
        role,
        store_id: storeId,
        must_change_password: true,
      },
      { onConflict: "user_id" }
    );

    if (upErr) return new Response(JSON.stringify({ ok: false, error: upErr.message }), { status: 400 });

    return new Response(JSON.stringify({ ok: true, userId: finalUserId }), { status: 200 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return new Response(JSON.stringify({ ok: false, error: msg }), { status: 500 });
  }
});
