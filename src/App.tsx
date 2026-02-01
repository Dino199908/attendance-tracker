import React, { useEffect, useMemo, useState } from "react";

// ================= TYPES =================
type InfractionType =
  | "Call Out (Prior to shift)"
  | "Call Out (After shift starts)"
  | "No Call / No Show"
  | "Tardy (16-59 min)"
  | "Tardy (60+ min)"
  | "Early Departure (16-59 min)"
  | "Early Departure (60+ min)"
  | "Late Return (16-59 min)"
  | "Late Return (60+ min)";

type Infraction = {
  id: string;
  type: InfractionType;
  points: number;
  date: string; // YYYY-MM-DD
  store: string;
  reason: string;
};

type Employee = {
  id: string; // internal row id
  employeeId: string; // numbers-only, required, unique
  name: string; // Employee's Name
  infractions: Infraction[];
};

type View =
  | { name: "list" }
  | { name: "employee"; employeeRowId: string }
  | { name: "settings" };

type BadgeTone = "neutral" | "ok" | "warn" | "danger";

type ConfirmState =
  | { open: false }
  | {
      open: true;
      title: string;
      message: string;
      confirmText?: string;
      danger?: boolean;
      onConfirm: () => void;
    };

type UpdateStatus =
  | { state: "idle" }
  | { state: "checking"; message?: string }
  | { state: "none"; currentVersion?: string; message?: string }
  | {
      state: "available";
      currentVersion?: string;
      latestVersion?: string;
      message?: string;
    }
  | { state: "downloading"; percent?: number; message?: string }
  | { state: "ready"; latestVersion?: string; message?: string }
  | { state: "error"; message?: string };

type ThemeMode = "dark" | "light";

// ================= CONSTANTS =================
const STORAGE_KEY = "attendance_tracker_v_final";
const STORES_KEY = "attendance_tracker_stores_v_final";
const THEME_MODE_KEY = "attendance_tracker_theme_mode_v1";
const AUTO_REMOVE_DAYS = 180;

const THEME = {
  bg: "var(--bg)",
  card: "var(--card)",
  border: "var(--border)",
  text: "var(--text)",
  muted: "var(--muted)",
  primary: "var(--primary)",
  danger: "var(--danger)",
  warn: "var(--warn)",
  ok: "var(--ok)",
  fieldBg: "var(--fieldBg)",
  subtleBg: "var(--subtleBg)",
} as const;

const PALETTES: Record<ThemeMode, Record<string, string>> = {
  dark: {
    "--bg": "#0f172a",
    "--card": "#020617",
    "--border": "#1e293b",
    "--text": "#e5e7eb",
    "--muted": "#94a3b8",
    "--primary": "#38bdf8",
    "--danger": "#ef4444",
    "--warn": "#f59e0b",
    "--ok": "#22c55e",
    "--fieldBg": "rgba(255,255,255,0.04)",
    "--subtleBg": "rgba(255,255,255,0.02)",
    "--calendarInvert": "1",
  },
  light: {
    "--bg": "#f8fafc",
    "--card": "#ffffff",
    "--border": "#cbd5e1",
    "--text": "#0f172a",
    "--muted": "#475569",
    "--primary": "#0284c7",
    "--danger": "#dc2626",
    "--warn": "#d97706",
    "--ok": "#16a34a",
    "--fieldBg": "#ffffff",
    "--subtleBg": "rgba(15,23,42,0.04)",
    "--calendarInvert": "0",
  },
};

// ================= UPDATER BRIDGE =================
declare global {
  interface Window {
    attendanceUpdater?: {
      getVersion: () => Promise<string>;
      check: () => Promise<{
        ok: boolean;
        message?: string;
        currentVersion?: string;
        latestVersion?: string;
      }>;
      installNow: () => Promise<{ ok: boolean; message?: string }>;
      onStatus: (cb: (payload: any) => void) => () => void;
    };
  }
}

// ================= HELPERS =================
function newId() {
  return crypto.randomUUID();
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function digitsOnly(s: string) {
  return String(s ?? "").replace(/[^0-9]+/g, "");
}

function isOlderThanDays(dateISO: string, days: number): boolean {
  const d = new Date(dateISO);
  if (Number.isNaN(d.getTime())) return false;
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - days);
  return d < cutoff;
}

function pointsForType(type: InfractionType): number {
  switch (type) {
    case "Call Out (Prior to shift)":
      return 3;
    case "Call Out (After shift starts)":
      return 8;
    case "No Call / No Show":
      return 8;
    case "Tardy (16-59 min)":
      return 1;
    case "Tardy (60+ min)":
      return 2;
    case "Early Departure (16-59 min)":
      return 1;
    case "Early Departure (60+ min)":
      return 2;
    case "Late Return (16-59 min)":
      return 1;
    case "Late Return (60+ min)":
      return 2;
  }
}

function labelForType(type: InfractionType): string {
  switch (type) {
    case "Call Out (Prior to shift)":
      return "Call Out (prior to shift)";
    case "Call Out (After shift starts)":
      return "Call Out (after shift starts)";
    case "No Call / No Show":
      return "No Call / No Show";
    case "Tardy (16-59 min)":
      return "Tardy (over 15 min, under 1 hr)";
    case "Tardy (60+ min)":
      return "Tardy (over 1 hr)";
    case "Early Departure (16-59 min)":
      return "Early Departure (over 15 min, under 1 hr)";
    case "Early Departure (60+ min)":
      return "Early Departure (over 1 hr)";
    case "Late Return (16-59 min)":
      return "Late Return (over 15 min, under 1 hr)";
    case "Late Return (60+ min)":
      return "Late Return (over 1 hr)";
  }
}

function statusForPoints(total: number) {
  if (total >= 12) return "Termination";
  if (total >= 8) return "Final Written Warning";
  if (total >= 6) return "First Written Warning";
  return "OK";
}

function toneForStatus(status: string): BadgeTone {
  if (status === "Termination") return "danger";
  if (status === "Final Written Warning") return "warn";
  if (status === "First Written Warning") return "neutral";
  return "ok";
}

function sumPoints(infractions: Infraction[]) {
  return infractions.reduce((s, i) => s + i.points, 0);
}

function escapeHtml(s: string) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function exportEmployeePDF(employee: Employee) {
  const total = sumPoints(employee.infractions);
  const status = statusForPoints(total);
  const stamp = new Date().toISOString().slice(0, 10);
  const safeName = employee.name.replace(/[^a-z0-9\- _]/gi, "").trim() || "employee";

  const rows = employee.infractions
    .slice()
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .map(
      (i) => `
      <tr>
        <td>${escapeHtml(i.date)}</td>
        <td>${escapeHtml(i.store)}</td>
        <td>${escapeHtml(labelForType(i.type))}</td>
        <td style="text-align:right;font-weight:700;">${escapeHtml(String(i.points))}</td>
        <td>${escapeHtml(i.reason || "")}</td>
      </tr>
    `
    )
    .join("");

  const html = `
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Attendance Tracker - ${escapeHtml(employee.employeeId)} - ${escapeHtml(employee.name)}</title>
    <style>
      @page { margin: 18mm; }
      body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; color: #0f172a; }
      h1 { font-size: 18px; margin: 0 0 6px; }
      .muted { color: #475569; font-size: 12px; }
      .meta { margin-top: 10px; display: grid; grid-template-columns: 1fr 1fr; gap: 8px 18px; font-size: 12px; }
      .pill { display: inline-block; padding: 6px 10px; border-radius: 999px; background: #e2e8f0; font-weight: 800; font-size: 12px; }
      .totals { margin-top: 10px; display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
      table { width: 100%; border-collapse: collapse; margin-top: 14px; font-size: 12px; }
      th, td { border: 1px solid #cbd5e1; padding: 8px; vertical-align: top; }
      th { background: #f1f5f9; text-align: left; }
      .footer { margin-top: 12px; font-size: 11px; color: #64748b; }
      .small { font-size: 11px; }
    </style>
  </head>
  <body>
    <h1>Attendance Tracker</h1>
    <div class="muted">Employee report (exported ${escapeHtml(stamp)})</div>

    <div class="meta">
      <div><span class="muted">Employee ID:</span> <strong>${escapeHtml(employee.employeeId)}</strong></div>
      <div><span class="muted">Employee Name:</span> <strong>${escapeHtml(employee.name)}</strong></div>
    </div>

    <div class="totals">
      <div class="pill">Status: ${escapeHtml(status)}</div>
      <div class="pill">Total Points: ${escapeHtml(String(total))}</div>
      <div class="muted small">(Infractions auto-remove after ${AUTO_REMOVE_DAYS} days)</div>
    </div>

    <table>
      <thead>
        <tr>
          <th style="width: 92px;">Date</th>
          <th style="width: 80px;">Store</th>
          <th>Infraction</th>
          <th style="width: 60px; text-align:right;">Points</th>
          <th style="width: 220px;">Reason</th>
        </tr>
      </thead>
      <tbody>
        ${rows || `<tr><td colspan="5" class="muted">No infractions.</td></tr>`}
      </tbody>
    </table>

    <div class="footer">PRS Wal-Mart Wireless Attendance Policy (Revised May 2025) • Exported from Attendance Tracker</div>

    <script>
      window.addEventListener('load', () => {
        try {
          document.title = 'attendance-${employee.employeeId}-${safeName}-${stamp}';
          window.print();
        } catch (e) {}
      });
    </script>
  </body>
</html>
`;

  const w = window.open("", "_blank");
  if (!w) {
    alert("Popup blocked. Please allow popups to export PDF.");
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
}

function loadEmployees(): Employee[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed.map((e: any) => {
      const infractions: Infraction[] = Array.isArray(e?.infractions)
        ? e.infractions
            .map((x: any) => {
              const type = String(x?.type ?? "Tardy (16-59 min)") as InfractionType;
              const date = String(x?.date ?? todayISO());
              return {
                id: String(x?.id ?? newId()),
                type,
                points: Number(x?.points ?? pointsForType(type)),
                date,
                store: String(x?.store ?? ""),
                reason: String(x?.reason ?? ""),
              } as Infraction;
            })
            .filter((inf: Infraction) => !isOlderThanDays(inf.date, AUTO_REMOVE_DAYS))
        : [];

      return {
        id: String(e?.id ?? newId()),
        employeeId: digitsOnly(String(e?.employeeId ?? "")),
        name: String(e?.name ?? "Employee"),
        infractions,
      } as Employee;
    });
  } catch {
    return [];
  }
}

function saveEmployees(data: Employee[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function loadStores(): string[] {
  try {
    const raw = localStorage.getItem(STORES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x) => typeof x === "string")
      .map((x) => x.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function saveStores(data: string[]) {
  localStorage.setItem(STORES_KEY, JSON.stringify(data));
}

function normalizeEmployees(data: Employee[]): Employee[] {
  const seen = new Set<string>();
  const out: Employee[] = [];
  for (const e of data) {
    const eid = digitsOnly(e.employeeId);
    if (!eid) continue;
    if (seen.has(eid)) continue;
    seen.add(eid);
    out.push({ ...e, employeeId: eid });
  }
  return out;
}

function loadThemeMode(): ThemeMode {
  const raw = localStorage.getItem(THEME_MODE_KEY);
  return raw === "light" ? "light" : "dark";
}

function saveThemeMode(mode: ThemeMode) {
  localStorage.setItem(THEME_MODE_KEY, mode);
}

function applyTheme(mode: ThemeMode) {
  const p = PALETTES[mode];
  for (const [k, v] of Object.entries(p)) {
    document.documentElement.style.setProperty(k, v);
  }
}

// ================= APP =================
export default function App() {
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => loadThemeMode());
  const [employees, setEmployees] = useState<Employee[]>(() => normalizeEmployees(loadEmployees()));
  const [stores, setStores] = useState<string[]>(() => loadStores());
  const [view, setView] = useState<View>({ name: "list" });
  const [confirm, setConfirm] = useState<ConfirmState>({ open: false });

  useEffect(() => {
    applyTheme(themeMode);
    saveThemeMode(themeMode);
  }, [themeMode]);

  useEffect(() => saveEmployees(employees), [employees]);
  useEffect(() => saveStores(stores), [stores]);

  useEffect(() => {
    setEmployees((prev) => {
      let changed = false;
      const next = prev.map((e) => {
        const kept = e.infractions.filter((inf) => !isOlderThanDays(inf.date, AUTO_REMOVE_DAYS));
        if (kept.length !== e.infractions.length) changed = true;
        return kept.length === e.infractions.length ? e : { ...e, infractions: kept };
      });
      return changed ? next : prev;
    });
  }, []);

  const selected = view.name === "employee" ? employees.find((e) => e.id === view.employeeRowId) : null;

  function addEmployee(name: string, employeeIdRaw: string) {
    const n = name.trim();
    const eid = digitsOnly(employeeIdRaw).trim();
    if (!n || !eid) return;
    if (employees.some((e) => e.employeeId === eid)) return;
    setEmployees([{ id: newId(), name: n, employeeId: eid, infractions: [] }, ...employees]);
  }

  function updateEmployeeName(rowId: string, name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    setEmployees(employees.map((e) => (e.id === rowId ? { ...e, name: trimmed } : e)));
  }

  function updateEmployeeId(rowId: string, employeeIdRaw: string) {
    const eid = digitsOnly(employeeIdRaw);
    if (!eid) {
      setEmployees(employees.map((e) => (e.id === rowId ? { ...e, employeeId: "" } : e)));
      return;
    }
    const existsOther = employees.some((e) => e.employeeId === eid && e.id !== rowId);
    if (existsOther) return;
    setEmployees(employees.map((e) => (e.id === rowId ? { ...e, employeeId: eid } : e)));
  }

  function deleteEmployee(rowId: string) {
    setEmployees(employees.filter((e) => e.id !== rowId));
    setView({ name: "list" });
  }

  function addInfraction(empRowId: string, inf: Omit<Infraction, "id">) {
    setEmployees(
      employees.map((e) =>
        e.id === empRowId ? { ...e, infractions: [{ ...inf, id: newId() }, ...e.infractions] } : e
      )
    );
  }

  function deleteInfraction(empRowId: string, infractionId: string) {
    setEmployees(
      employees.map((e) =>
        e.id === empRowId ? { ...e, infractions: e.infractions.filter((i) => i.id !== infractionId) } : e
      )
    );
  }

  function addStore(raw: string) {
    const trimmed = String(raw ?? "").trim();
    if (!trimmed) return;
    if (stores.includes(trimmed)) return;
    setStores([trimmed, ...stores]);
  }

  function deleteStore(storeValue: string) {
    const trimmed = String(storeValue ?? "").trim();
    if (!trimmed) return;
    setStores(stores.filter((x) => x !== trimmed));
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: THEME.bg,
        color: THEME.text,
        padding: 16,
        fontFamily: "system-ui, Arial",
      }}
    >
      <style>{`
        input[type="date"]::-webkit-calendar-picker-indicator {
          filter: invert(var(--calendarInvert));
          opacity: 1;
        }
        select { color-scheme: light dark; }
        option { background: var(--card); color: var(--text); }
      `}</style>

      {view.name === "list" && (
        <EmployeeList
          employees={employees}
          stores={stores}
          onAddEmployee={addEmployee}
          onSettings={() => setView({ name: "settings" })}
          onDelete={(rowId, label) =>
            setConfirm({
              open: true,
              title: "Delete Employee",
              message: `Delete ${label}? This cannot be undone.`,
              danger: true,
              confirmText: "Delete",
              onConfirm: () => {
                setConfirm({ open: false });
                deleteEmployee(rowId);
              },
            })
          }
          onOpen={(rowId) => setView({ name: "employee", employeeRowId: rowId })}
          onAddStore={(s) => addStore(s)}
          onDeleteStore={(s) =>
            setConfirm({
              open: true,
              title: "Delete Store",
              message: `Delete store ${String(s)}?`,
              danger: true,
              confirmText: "Delete",
              onConfirm: () => {
                setConfirm({ open: false });
                deleteStore(String(s));
              },
            })
          }
        />
      )}

      {view.name === "employee" && selected && (
        <EmployeePage
          employee={selected}
          employees={employees}
          stores={stores}
          onBack={() => setView({ name: "list" })}
          onRename={(name) => updateEmployeeName(selected.id, name)}
          onChangeEmployeeId={(eid) => updateEmployeeId(selected.id, eid)}
          onAdd={(data) => addInfraction(selected.id, data)}
          onExportPDF={() => exportEmployeePDF(selected)}
          onDeleteInfraction={(infractionId) => {
            const inf = selected.infractions.find((x) => x.id === infractionId);
            const label = inf ? `${labelForType(inf.type)} • ${inf.points} pts • ${inf.date}` : "this infraction";
            setConfirm({
              open: true,
              title: "Delete Infraction",
              message: `Delete ${label}? This cannot be undone.`,
              danger: true,
              confirmText: "Delete",
              onConfirm: () => {
                setConfirm({ open: false });
                deleteInfraction(selected.id, infractionId);
              },
            });
          }}
        />
      )}

      {view.name === "settings" && (
        <SettingsPage
          onBack={() => setView({ name: "list" })}
          themeMode={themeMode}
          onThemeMode={(m) => setThemeMode(m)}
        />
      )}

      {confirm.open && <ConfirmDialog state={confirm} onCancel={() => setConfirm({ open: false })} />}
    </div>
  );
}

// ================= COMPONENTS =================
function EmployeeList(props: {
  employees: Employee[];
  stores: string[];
  onAddEmployee: (name: string, employeeId: string) => void;
  onDelete: (rowId: string, label: string) => void;
  onOpen: (rowId: string) => void;
  onAddStore: (store: string) => void;
  onDeleteStore: (store: string) => void;
  onSettings: () => void;
}) {
  const [name, setName] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [store, setStore] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [storeMsg, setStoreMsg] = useState<string | null>(null);

  function submitEmployee() {
    const n = name.trim();
    const eid = digitsOnly(employeeId).trim();

    if (!n && !eid) {
      setError("Employee's Name and Employee ID are required.");
      return;
    }
    if (!n) {
      setError("Employee's Name is required.");
      return;
    }
    if (!eid) {
      setError("Employee ID is required (numbers only).");
      return;
    }

    const exists = props.employees.some((e) => String(e.employeeId) === eid);
    if (exists) {
      setError(`Employee ID ${eid} already exists. Employee IDs must be unique.`);
      return;
    }

    setError(null);
    props.onAddEmployee(n, eid);
    setName("");
    setEmployeeId("");
  }

  function submitStore(raw: string) {
    const trimmed = String(raw ?? "").trim();

    if (!trimmed) {
      setStoreMsg("Store # is required.");
      return;
    }

    const exists = props.stores.includes(trimmed);
    if (exists) {
      setStoreMsg(`Store ${trimmed} already exists.`);
      return;
    }

    props.onAddStore(trimmed);
    setStore("");
    setStoreMsg(`Added store ${trimmed}.`);
  }

  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
        <div>
          <h2 style={{ margin: 0 }}>Employees</h2>
          <div style={{ color: THEME.muted, fontSize: 12 }}>Offline • Saved locally</div>
        </div>
        <button onClick={props.onSettings} style={btnStyle("ghost")}>
          Settings
        </button>
      </div>

      <Card>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submitEmployee();
              }
            }}
            placeholder="Employee's Name"
            style={inputStyle()}
          />

          <input
            value={employeeId}
            onChange={(e) => {
              setEmployeeId(digitsOnly(e.target.value));
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submitEmployee();
              }
            }}
            placeholder="Employee ID (numbers only)"
            inputMode="numeric"
            style={inputStyle()}
          />

          <button onClick={submitEmployee} style={btnStyle("primary")}>
            Add Employee
          </button>
        </div>

        {error && <div style={{ marginTop: 10, color: THEME.danger, fontWeight: 900 }}>{error}</div>}

        <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
          {props.employees.length === 0 ? (
            <div style={{ color: THEME.muted }}>No employees yet.</div>
          ) : (
            props.employees.map((e) => {
              const total = sumPoints(e.infractions);
              return (
                <div
                  key={e.id}
                  style={{
                    border: `1px solid ${THEME.border}`,
                    borderRadius: 14,
                    padding: 12,
                    background: THEME.subtleBg,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 900 }}>{e.name}</div>
                    <div style={{ fontSize: 12, color: THEME.muted }}>
                      ID: {e.employeeId} • {total} pts
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={() => props.onOpen(e.id)} style={btnStyle("ghost")}>
                      Open
                    </button>
                    <button onClick={() => props.onDelete(e.id, e.name)} style={btnStyle("danger")}>
                      Delete
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </Card>

      <Card>
        <h3 style={{ marginTop: 0 }}>Stores</h3>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <input
            value={store}
            onChange={(e) => {
              setStore(e.target.value);
              setStoreMsg(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submitStore(store);
              }
            }}
            placeholder="Store #"
            style={inputStyle()}
          />
          <button onClick={() => submitStore(store)} style={btnStyle("primary")}>
            Add Store
          </button>
        </div>

        {storeMsg && (
          <div
            style={{
              marginTop: 10,
              color: storeMsg.startsWith("Added") ? THEME.ok : THEME.warn,
              fontWeight: 900,
            }}
          >
            {storeMsg}
          </div>
        )}

        {props.stores.length > 0 && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
            {props.stores.map((s) => (
              <span
                key={s}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  border: `1px solid ${THEME.border}`,
                  padding: "6px 10px",
                  borderRadius: 999,
                  background: THEME.subtleBg,
                  fontWeight: 900,
                }}
              >
                {s}
                <button
                  title="Delete store"
                  onClick={() => props.onDeleteStore(s)}
                  style={{
                    border: "none",
                    background: "transparent",
                    color: THEME.danger,
                    cursor: "pointer",
                    fontWeight: 900,
                    lineHeight: 1,
                    fontSize: 16,
                  }}
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function EmployeePage(props: {
  employee: Employee;
  employees: Employee[];
  stores: string[];
  onBack: () => void;
  onRename: (name: string) => void;
  onChangeEmployeeId: (employeeId: string) => void;
  onAdd: (data: Omit<Infraction, "id">) => void;
  onExportPDF: () => void;
  onDeleteInfraction: (infractionId: string) => void;
}) {
  const [name, setName] = useState(props.employee.name);
  const [employeeId, setEmployeeId] = useState(props.employee.employeeId);

  const [type, setType] = useState<InfractionType>("Tardy (16-59 min)");
  const [date, setDate] = useState(todayISO());
  const [store, setStore] = useState(props.stores[0] ?? "");
  const [reason, setReason] = useState("");

  const [showPolicy, setShowPolicy] = useState(false);
  const [idError, setIdError] = useState<string | null>(null);

  useEffect(() => setName(props.employee.name), [props.employee.name]);
  useEffect(() => setEmployeeId(props.employee.employeeId), [props.employee.employeeId]);

  const points = useMemo(() => pointsForType(type), [type]);
  const total = useMemo(() => sumPoints(props.employee.infractions), [props.employee.infractions]);
  const status = useMemo(() => statusForPoints(total), [total]);
  const tone = useMemo(() => toneForStatus(status), [status]);

  return (
    <div style={{ maxWidth: 980, margin: "0 auto" }}>
      <button onClick={props.onBack} style={btnStyle("ghost")}>
        Back
      </button>

      <Card>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ minWidth: 260, flex: "1 1 520px", display: "grid", gap: 10 }}>
            <div>
              <div style={{ color: THEME.muted, fontSize: 12, marginBottom: 6 }}>Employee's Name</div>
              <input
                value={name}
                onChange={(e) => {
                  const v = e.target.value;
                  setName(v);
                  props.onRename(v);
                }}
                placeholder="Employee's Name"
                style={inputStyle("wide")}
              />
              <div style={{ marginTop: 6, fontSize: 12, color: THEME.muted }}>Updates automatically</div>
            </div>

            <div>
              <div style={{ color: THEME.muted, fontSize: 12, marginBottom: 6 }}>Employee ID (numbers only • required • unique)</div>
              <input
                value={employeeId}
                onChange={(e) => {
                  const v = digitsOnly(e.target.value);
                  setEmployeeId(v);
                  setIdError(null);
                  props.onChangeEmployeeId(v);
                }}
                onBlur={() => {
                  const v = digitsOnly(employeeId).trim();
                  if (!v) {
                    setIdError("Employee ID is required (numbers only).");
                    return;
                  }
                  const existsOther = props.employees.some((x) => x.employeeId === v && x.id !== props.employee.id);
                  if (existsOther) {
                    setIdError(`Employee ID ${v} already exists.`);
                  }
                }}
                placeholder="Employee ID"
                inputMode="numeric"
                style={inputStyle("wide")}
              />
              {idError && <div style={{ marginTop: 6, color: THEME.danger, fontWeight: 900 }}>{idError}</div>}
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", flex: "0 0 auto" }}>
            <StatusPill status={status} total={total} tone={tone} />
          </div>
        </div>
      </Card>

      <Card>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <h3 style={{ margin: 0 }}>Add Infraction</h3>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <button onClick={props.onExportPDF} style={btnStyle("ghost")}>
              Export Employee (PDF)
            </button>
            <button onClick={() => setShowPolicy((v) => !v)} style={btnStyle("ghost")}>
              {showPolicy ? "Hide Policy Reference" : "View Policy Reference"}
            </button>
          </div>
        </div>

        {showPolicy && (
          <div style={{ marginTop: 12, border: `1px solid ${THEME.border}`, borderRadius: 14, padding: 12, background: THEME.subtleBg }}>
            <div style={{ fontWeight: 900, marginBottom: 6 }}>Attendance policy reference</div>
            <div style={{ color: THEME.muted, fontSize: 12, marginBottom: 10 }}>PRS Wal-Mart Wireless Attendance Policy (Revised May 2025)</div>
            <div style={{ display: "grid", gap: 6, fontSize: 13 }}>
              <div>
                • Call Out (prior to shift): <strong>3</strong> points
              </div>
              <div>
                • Call Out (after shift starts): <strong>8</strong> points
              </div>
              <div>
                • No Call / No Show: <strong>8</strong> points
              </div>
              <div>• Tardy / Early Departure / Late Return:</div>
              <div style={{ paddingLeft: 14 }}>
                – Over 15 minutes, under 1 hour: <strong>1</strong> point
              </div>
              <div style={{ paddingLeft: 14 }}>
                – Over 1 hour: <strong>2</strong> points
              </div>
              <div style={{ marginTop: 8 }}>
                • <strong>6</strong> points: First Written Warning
              </div>
              <div>
                • <strong>8</strong> points: Final Written Warning
              </div>
              <div>
                • <strong>12</strong> points: Termination
              </div>
            </div>
          </div>
        )}

        <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 12, color: THEME.muted }}>Type</span>
            <select value={type} onChange={(e) => setType(e.target.value as InfractionType)} style={selectStyle()}>
              <option value="Call Out (Prior to shift)">{labelForType("Call Out (Prior to shift)")} — 3 pts</option>
              <option value="Call Out (After shift starts)">{labelForType("Call Out (After shift starts)")} — 8 pts</option>
              <option value="No Call / No Show">{labelForType("No Call / No Show")} — 8 pts</option>
              <option value="Tardy (16-59 min)">{labelForType("Tardy (16-59 min)")} — 1 pt</option>
              <option value="Tardy (60+ min)">{labelForType("Tardy (60+ min)")} — 2 pts</option>
              <option value="Early Departure (16-59 min)">{labelForType("Early Departure (16-59 min)")} — 1 pt</option>
              <option value="Early Departure (60+ min)">{labelForType("Early Departure (60+ min)")} — 2 pts</option>
              <option value="Late Return (16-59 min)">{labelForType("Late Return (16-59 min)")} — 1 pt</option>
              <option value="Late Return (60+ min)">{labelForType("Late Return (60+ min)")} — 2 pts</option>
            </select>
          </label>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, color: THEME.muted }}>Date</span>
              <input value={date} type="date" onChange={(e) => setDate(e.target.value)} style={inputStyle("wide")} />
            </label>

            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, color: THEME.muted }}>Scheduled Store</span>
              <select value={store} onChange={(e) => setStore(e.target.value)} style={selectStyle()}>
                {props.stores.length === 0 ? (
                  <option value="">(No stores yet)</option>
                ) : (
                  props.stores.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))
                )}
              </select>
            </label>
          </div>

          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 12, color: THEME.muted }}>Reason (optional)</span>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason / notes (optional)" style={textareaStyle()} />
          </label>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <div style={{ color: THEME.muted, fontSize: 13 }}>
              Points: <strong style={{ color: THEME.text }}>{points}</strong>
            </div>
            <button
              onClick={() => {
                props.onAdd({ type, date, store, points, reason });
                setReason("");
              }}
              style={btnStyle("primary")}
            >
              Add Infraction
            </button>
          </div>
        </div>
      </Card>

      <Card>
        <h3 style={{ marginTop: 0 }}>Infractions</h3>
        {props.employee.infractions.length === 0 ? (
          <div style={{ color: THEME.muted }}>No infractions yet.</div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {props.employee.infractions.map((i) => (
              <div
                key={i.id}
                style={{ border: `1px solid ${THEME.border}`, borderRadius: 14, padding: 12, background: THEME.subtleBg }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ fontWeight: 900 }}>{labelForType(i.type)}</div>
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <div style={{ color: THEME.muted }}>{i.points} pts</div>
                    <button onClick={() => props.onDeleteInfraction(i.id)} style={btnStyle("danger")}>
                      Delete
                    </button>
                  </div>
                </div>
                <div style={{ marginTop: 6, color: THEME.muted, fontSize: 13 }}>
                  {i.date} • Store: {i.store}
                  {i.reason ? ` • Reason: ${i.reason}` : ""}
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={{ marginTop: 10, color: THEME.muted, fontSize: 12 }}>Infractions automatically remove after {AUTO_REMOVE_DAYS} days.</div>
      </Card>
    </div>
  );
}

function SettingsPage(props: { onBack: () => void; themeMode: ThemeMode; onThemeMode: (m: ThemeMode) => void }) {
  const [version, setVersion] = useState<string>("(unknown)");
  const [status, setStatus] = useState<UpdateStatus>({ state: "idle" });

  useEffect(() => {
    let off: (() => void) | undefined;

    const up = window.attendanceUpdater;
    if (!up) {
      setVersion("(offline build)");
      setStatus({ state: "none", message: "Updater not available in this build." });
      return;
    }

    up.getVersion()
      .then((v) => setVersion(v))
      .catch(() => setVersion("(unknown)"));

    off = up.onStatus((payload: any) => {
      if (payload && typeof payload === "object" && typeof payload.state === "string") {
        setStatus(payload as UpdateStatus);
      }
    });

    return () => {
      if (off) off();
    };
  }, []);

  async function checkUpdates() {
    const up = window.attendanceUpdater;
    if (!up) {
      setStatus({ state: "error", message: "Updater not available." });
      return;
    }

    setStatus({ state: "checking" });
    try {
      const res = await up.check();
      if (!res.ok) {
        setStatus({ state: "error", message: res.message || "Update check failed." });
        return;
      }

      const cur = res.currentVersion;
      const latest = res.latestVersion;
      if (latest && cur && latest !== cur) {
        setStatus({ state: "available", currentVersion: cur, latestVersion: latest, message: "Update available." });
      } else {
        setStatus({ state: "none", currentVersion: cur, message: "Up to date." });
      }
    } catch (e: any) {
      setStatus({ state: "error", message: e?.message || "Update check failed." });
    }
  }

  async function installNow() {
    const up = window.attendanceUpdater;
    if (!up) return;
    try {
      const res = await up.installNow();
      if (!res.ok) setStatus({ state: "error", message: res.message || "Install failed." });
    } catch (e: any) {
      setStatus({ state: "error", message: e?.message || "Install failed." });
    }
  }

  const statusText = (() => {
    switch (status.state) {
      case "idle":
        return "—";
      case "checking":
        return "Checking for updates…";
      case "available":
        return `Update available: ${status.latestVersion ?? ""}`.trim();
      case "none":
        return status.message || "Up to date.";
      case "downloading":
        return status.message || `Downloading… ${status.percent ?? 0}%`;
      case "ready":
        return status.message || "Ready to install.";
      case "error":
        return status.message || "Updater error.";
    }
  })();

  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      <button onClick={props.onBack} style={btnStyle("ghost")}>
        Back
      </button>

      <Card>
        <h2 style={{ marginTop: 0 }}>Settings</h2>

        <div style={{ display: "grid", gap: 14 }}>
          <div>
            <div style={{ color: THEME.muted, fontSize: 12, marginBottom: 8 }}>Theme</div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button onClick={() => props.onThemeMode("dark")} style={props.themeMode === "dark" ? btnStyle("primary") : btnStyle("ghost")}>
                Dark
              </button>
              <button onClick={() => props.onThemeMode("light")} style={props.themeMode === "light" ? btnStyle("primary") : btnStyle("ghost")}>
                Light
              </button>
            </div>
          </div>

          <div>
            <div style={{ color: THEME.muted, fontSize: 12, marginBottom: 8 }}>Version</div>
            <div style={{ fontWeight: 900 }}>{version}</div>
          </div>

          <div>
            <div style={{ color: THEME.muted, fontSize: 12, marginBottom: 8 }}>Updates</div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <button onClick={checkUpdates} style={btnStyle("ghost")}>
                Check for updates
              </button>
              {status.state === "ready" && (
                <button onClick={installNow} style={btnStyle("primary")}>
                  Install & Restart
                </button>
              )}
            </div>
            <div style={{ marginTop: 8, color: THEME.muted, fontSize: 12 }}>{statusText}</div>
          </div>
        </div>
      </Card>
    </div>
  );
}

function StatusPill(props: { status: string; total: number; tone: BadgeTone }) {
  const colors: Record<BadgeTone, { border: string; bg: string; fg: string }> = {
    neutral: { border: THEME.border, bg: "rgba(255,255,255,0.03)", fg: THEME.text },
    ok: { border: THEME.ok, bg: "rgba(34,197,94,0.12)", fg: THEME.ok },
    warn: { border: THEME.warn, bg: "rgba(245,158,11,0.12)", fg: THEME.warn },
    danger: { border: THEME.danger, bg: "rgba(239,68,68,0.12)", fg: THEME.danger },
  };

  const s = colors[props.tone];

  return (
    <div
      style={{
        border: `3px solid ${s.border}`,
        background: s.bg,
        color: s.fg,
        borderRadius: 999,
        padding: "12px 16px",
        fontWeight: 900,
        fontSize: 18,
        display: "flex",
        alignItems: "center",
        gap: 10,
        minHeight: 52,
      }}
      title="Attendance Status"
    >
      <span style={{ color: THEME.muted, fontSize: 12, fontWeight: 900 }}>Status</span>
      <span>{props.status}</span>
      <span style={{ color: THEME.text, opacity: 0.6 }}>•</span>
      <span style={{ color: THEME.text }}>{props.total} pts</span>
    </div>
  );
}

function Card(props: { children: React.ReactNode }) {
  return (
    <div
      style={{
        border: `1px solid ${THEME.border}`,
        borderRadius: 16,
        padding: 14,
        margin: "12px 0",
        background: THEME.card,
        boxShadow: "0 8px 30px rgba(0,0,0,0.25)",
      }}
    >
      {props.children}
    </div>
  );
}

function inputStyle(width: "normal" | "wide" = "normal"): React.CSSProperties {
  return {
    width: width === "wide" ? "100%" : 260,
    maxWidth: "100%",
    padding: 10,
    borderRadius: 12,
    border: `1px solid ${THEME.border}`,
    background: THEME.fieldBg,
    color: THEME.text,
    outline: "none",
  };
}

function selectStyle(): React.CSSProperties {
  return {
    width: "100%",
    padding: 10,
    borderRadius: 12,
    border: `1px solid ${THEME.border}`,
    background: THEME.fieldBg,
    color: THEME.text,
    outline: "none",
  };
}

function textareaStyle(): React.CSSProperties {
  return {
    width: "100%",
    padding: 10,
    minHeight: 70,
    borderRadius: 12,
    border: `1px solid ${THEME.border}`,
    background: THEME.fieldBg,
    color: THEME.text,
    outline: "none",
    resize: "vertical",
  };
}

function btnStyle(kind: "primary" | "ghost" | "danger"): React.CSSProperties {
  const base: React.CSSProperties = {
    padding: "10px 12px",
    borderRadius: 12,
    border: `1px solid ${THEME.border}`,
    fontWeight: 900,
    cursor: "pointer",
    background: THEME.subtleBg,
    color: THEME.text,
  };

  if (kind === "primary") return { ...base, background: THEME.primary, border: `1px solid ${THEME.primary}`, color: "#00111a" };
  if (kind === "danger") return { ...base, background: THEME.danger, border: `1px solid ${THEME.danger}`, color: "#0b0b0b" };
  return base;
}

function ConfirmDialog(props: { state: Extract<ConfirmState, { open: true }>; onCancel: () => void }) {
  const s = props.state;
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        zIndex: 9999,
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) props.onCancel();
      }}
    >
      <div
        style={{
          background: THEME.card,
          border: `1px solid ${THEME.border}`,
          borderRadius: 16,
          padding: 16,
          width: "100%",
          maxWidth: 420,
        }}
      >
        <div style={{ fontWeight: 900, fontSize: 16 }}>{s.title}</div>
        <p style={{ color: THEME.muted, marginTop: 8 }}>{s.message}</p>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={props.onCancel} style={btnStyle("ghost")}>
            Cancel
          </button>
          <button onClick={s.onConfirm} style={btnStyle(s.danger ? "danger" : "primary")}>
            {s.confirmText ?? "OK"}
          </button>
        </div>
      </div>
    </div>
  );
}
