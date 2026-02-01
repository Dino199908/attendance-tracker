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
  date: string;
  store: string;
  reason: string;
};

type Employee = {
  id: string;
  name: string;
  infractions: Infraction[];
};

type View =
  | { name: "list" }
  | { name: "employee"; employeeId: string }
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
  | { state: "checking" }
  | { state: "none"; currentVersion?: string }
  | { state: "available"; currentVersion?: string; latestVersion?: string }
  | { state: "downloading"; percent?: number }
  | { state: "ready"; latestVersion?: string }
  | { state: "error"; message?: string };

declare global {
  interface Window {
    attendanceUpdater?: {
      getVersion: () => Promise<string>;
      check: () => Promise<{ ok: boolean; message?: string }>;
      installNow: () => Promise<{ ok: boolean }>;
      onStatus: (cb: (payload: any) => void) => () => void;
    };
  }
}

type ThemeMode = "dark" | "light";

type Theme = {
  bg: string;
  card: string;
  border: string;
  text: string;
  muted: string;
  primary: string;
  danger: string;
  warn: string;
  ok: string;
  inputBg: string;
  softBg: string;
  shadow: string;
};

// ================= CONSTANTS =================
const STORAGE_KEY = "attendance_tracker_v2";
const STORES_KEY = "attendance_tracker_stores_v2";
const THEME_KEY = "attendance_tracker_theme_v2";

const DARK_THEME: Theme = {
  bg: "#0f172a",
  card: "#020617",
  border: "#1e293b",
  text: "#e5e7eb",
  muted: "#94a3b8",
  primary: "#38bdf8",
  danger: "#ef4444",
  warn: "#f59e0b",
  ok: "#22c55e",
  inputBg: "rgba(255,255,255,0.03)",
  softBg: "rgba(255,255,255,0.02)",
  shadow: "0 8px 30px rgba(0,0,0,0.25)",
};

const LIGHT_THEME: Theme = {
  bg: "#f8fafc",
  card: "#ffffff",
  border: "#e2e8f0",
  text: "#0f172a",
  muted: "#475569",
  primary: "#0284c7",
  danger: "#dc2626",
  warn: "#d97706",
  ok: "#16a34a",
  inputBg: "#f1f5f9",
  softBg: "#f8fafc",
  shadow: "0 8px 30px rgba(2,6,23,0.08)",
};

// ================= HELPERS =================
function newId() {
  return crypto.randomUUID();
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
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

function loadEmployees(): Employee[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed.map((e: any) => {
      const infractions = Array.isArray(e?.infractions)
        ? e.infractions.map((x: any) => {
            const type = String(x?.type ?? "Tardy (16-59 min)") as InfractionType;
            return {
              id: String(x?.id ?? newId()),
              type,
              points: Number(x?.points ?? pointsForType(type)),
              date: String(x?.date ?? todayISO()),
              store: String(x?.store ?? ""),
              reason: String(x?.reason ?? ""),
            } as Infraction;
          })
        : [];

      return {
        id: String(e?.id ?? newId()),
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

function loadThemeMode(): ThemeMode {
  const v = localStorage.getItem(THEME_KEY);
  return v === "light" ? "light" : "dark";
}

function saveThemeMode(mode: ThemeMode) {
  localStorage.setItem(THEME_KEY, mode);
}

// ================= APP =================
export default function App() {
  const [employees, setEmployees] = useState<Employee[]>(() => loadEmployees());
  const [stores, setStores] = useState<string[]>(() => loadStores());
  const [view, setView] = useState<View>({ name: "list" });
  const [confirm, setConfirm] = useState<ConfirmState>({ open: false });

  const [themeMode, setThemeMode] = useState<ThemeMode>(() => loadThemeMode());
  const theme = useMemo<Theme>(() => (themeMode === "light" ? LIGHT_THEME : DARK_THEME), [themeMode]);

  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ state: "idle" });

  useEffect(() => saveEmployees(employees), [employees]);
  useEffect(() => saveStores(stores), [stores]);
  useEffect(() => saveThemeMode(themeMode), [themeMode]);

  useEffect(() => {
    if (!window.attendanceUpdater) return;

    window.attendanceUpdater.getVersion().then((v) => {
      setUpdateStatus({ state: "none", currentVersion: v });
    });

    const off = window.attendanceUpdater.onStatus((payload) => {
      setUpdateStatus(payload);
    });

    return () => {
      if (off) off();
    };
  }, []);

  const selected =
    view.name === "employee"
      ? employees.find((e) => e.id === view.employeeId)
      : null;

  function addEmployee(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    setEmployees([{ id: newId(), name: trimmed, infractions: [] }, ...employees]);
  }

  function renameEmployee(id: string, name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    setEmployees(employees.map((e) => (e.id === id ? { ...e, name: trimmed } : e)));
  }

  function deleteEmployee(id: string) {
    setEmployees(employees.filter((e) => e.id !== id));
    setView({ name: "list" });
  }

  function addInfraction(empId: string, inf: Omit<Infraction, "id">) {
    setEmployees(
      employees.map((e) =>
        e.id === empId ? { ...e, infractions: [{ ...inf, id: newId() }, ...e.infractions] } : e
      )
    );
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: theme.bg,
        color: theme.text,
        padding: 16,
        fontFamily: "system-ui, Arial",
      }}
    >
      <style>{`
        input[type="date"]::-webkit-calendar-picker-indicator {
          filter: ${themeMode === "dark" ? "invert(1)" : "invert(0)"};
          opacity: 1;
        }
      `}</style>

      {window.attendanceUpdater && updateStatus.state !== "idle" && (
        <div
          style={{
            maxWidth: 980,
            margin: "0 auto 12px auto",
            borderRadius: 14,
            border: `1px solid ${theme.border}`,
            padding: 12,
            background: theme.softBg,
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            alignItems: "center",
            flexWrap: "wrap",
            boxShadow: theme.shadow,
          }}
        >
          <div style={{ fontWeight: 800 }}>
            {updateStatus.state === "checking" && "Checking for updates…"}
            {updateStatus.state === "none" &&
              `Up to date${updateStatus.currentVersion ? ` (v${updateStatus.currentVersion})` : ""}`}
            {updateStatus.state === "available" &&
              `Update available${updateStatus.latestVersion ? ` (v${updateStatus.latestVersion})` : ""} — downloading…`}
            {updateStatus.state === "downloading" && `Downloading update… ${updateStatus.percent ?? 0}%`}
            {updateStatus.state === "ready" &&
              `Update ready${updateStatus.latestVersion ? ` (v${updateStatus.latestVersion})` : ""}`}
            {updateStatus.state === "error" && `Updater error: ${updateStatus.message ?? "Unknown error"}`}
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => window.attendanceUpdater?.check()}
              style={btnStyle(theme, "ghost")}
            >
              Check now
            </button>

            {updateStatus.state === "ready" && (
              <button
                onClick={() => window.attendanceUpdater?.installNow()}
                style={btnStyle(theme, "primary")}
              >
                Update & Restart
              </button>
            )}
          </div>
        </div>
      )}

      {view.name === "list" && (
        <EmployeeList
          theme={theme}
          themeMode={themeMode}
          onOpenSettings={() => setView({ name: "settings" })}
          employees={employees}
          stores={stores}
          onAddEmployee={addEmployee}
          onDelete={(id, name) =>
            setConfirm({
              open: true,
              title: "Delete Employee",
              message: `Delete ${name}? This cannot be undone.`,
              danger: true,
              confirmText: "Delete",
              onConfirm: () => {
                setConfirm({ open: false });
                deleteEmployee(id);
              },
            })
          }
          onOpen={(id) => setView({ name: "employee", employeeId: id })}
          onAddStore={(s) => {
            const trimmed = String(s ?? "").trim();
            if (!trimmed) return;
            setStores(Array.from(new Set([trimmed, ...stores])));
          }}
        />
      )}

      {view.name === "employee" && selected && (
        <EmployeePage
          theme={theme}
          employee={selected}
          stores={stores}
          onBack={() => setView({ name: "list" })}
          onRename={(name) => renameEmployee(selected.id, name)}
          onAdd={(data) => addInfraction(selected.id, data)}
        />
      )}

      {view.name === "settings" && (
        <SettingsPage
          theme={theme}
          themeMode={themeMode}
          onSetThemeMode={setThemeMode}
          updateStatus={updateStatus}
          onBack={() => setView({ name: "list" })}
        />
      )}

      {confirm.open && <ConfirmDialog theme={theme} state={confirm} onCancel={() => setConfirm({ open: false })} />}
    </div>
  );
}

// ================= COMPONENTS =================
function EmployeeList(props: {
  theme: Theme;
  themeMode: ThemeMode;
  onOpenSettings: () => void;
  employees: Employee[];
  stores: string[];
  onAddEmployee: (name: string) => void;
  onDelete: (id: string, name: string) => void;
  onOpen: (id: string) => void;
  onAddStore: (store: string) => void;
}) {
  const [name, setName] = useState("");
  const [store, setStore] = useState("");

  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 12,
        }}
      >
        <div>
          <h2 style={{ margin: 0 }}>Employees</h2>
          <div style={{ color: props.theme.muted, fontSize: 12 }}>Offline • Saved locally</div>
        </div>

        <button onClick={props.onOpenSettings} style={btnStyle(props.theme, "ghost")}>
          Settings
        </button>
      </div>

      <Card theme={props.theme}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Employee name"
            style={inputStyle(props.theme)}
          />
          <button
            onClick={() => {
              props.onAddEmployee(name);
              setName("");
            }}
            style={btnStyle(props.theme, "primary")}
          >
            Add
          </button>
        </div>

        <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
          {props.employees.length === 0 ? (
            <div style={{ color: props.theme.muted }}>No employees yet.</div>
          ) : (
            props.employees.map((e) => (
              <div
                key={e.id}
                style={{
                  border: `1px solid ${props.theme.border}`,
                  borderRadius: 14,
                  padding: 12,
                  background: props.theme.softBg,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  boxShadow: props.theme.shadow,
                }}
              >
                <div>
                  <div style={{ fontWeight: 800 }}>{e.name}</div>
                  <div style={{ fontSize: 12, color: props.theme.muted }}>{sumPoints(e.infractions)} pts</div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => props.onOpen(e.id)} style={btnStyle(props.theme, "ghost")}>
                    Open
                  </button>
                  <button onClick={() => props.onDelete(e.id, e.name)} style={btnStyle(props.theme, "danger")}>
                    Delete
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </Card>

      <Card theme={props.theme}>
        <h3 style={{ marginTop: 0 }}>Stores</h3>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <input value={store} onChange={(e) => setStore(e.target.value)} placeholder="Store #" style={inputStyle(props.theme)} />
          <button
            onClick={() => {
              props.onAddStore(store);
              setStore("");
            }}
            style={btnStyle(props.theme, "primary")}
          >
            Add Store
          </button>
        </div>

        {props.stores.length > 0 && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
            {props.stores.map((s) => (
              <span
                key={s}
                style={{
                  border: `1px solid ${props.theme.border}`,
                  padding: "6px 10px",
                  borderRadius: 999,
                  background: props.theme.softBg,
                  fontWeight: 800,
                }}
              >
                {s}
              </span>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function SettingsPage(props: {
  theme: Theme;
  themeMode: ThemeMode;
  onSetThemeMode: (m: ThemeMode) => void;
  updateStatus: UpdateStatus;
  onBack: () => void;
}) {
  const currentVersion =
    props.updateStatus.state === "none" || props.updateStatus.state === "available"
      ? props.updateStatus.currentVersion
      : props.updateStatus.state === "idle"
      ? undefined
      : (props.updateStatus as any)?.currentVersion;

  const canUseUpdater = !!window.attendanceUpdater;

  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      <button onClick={props.onBack} style={btnStyle(props.theme, "ghost")}>
        Back
      </button>

      <Card theme={props.theme}>
        <h2 style={{ marginTop: 0 }}>Settings</h2>

        <div style={{ display: "grid", gap: 12 }}>
          <div
            style={{
              border: `1px solid ${props.theme.border}`,
              borderRadius: 14,
              padding: 12,
              background: props.theme.softBg,
              boxShadow: props.theme.shadow,
            }}
          >
            <div style={{ fontWeight: 900, marginBottom: 6 }}>App Version</div>
            <div style={{ color: props.theme.muted }}>
              {currentVersion ? `v${currentVersion}` : "Version not available (dev mode)"}{" "}
            </div>
            <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                onClick={() => window.attendanceUpdater?.check()}
                disabled={!canUseUpdater}
                style={btnStyle(props.theme, "ghost")}
              >
                Check for updates
              </button>
              {!canUseUpdater && (
                <div style={{ color: props.theme.muted, fontSize: 12, alignSelf: "center" }}>
                  Updater works in the installed app (not desktop:dev).
                </div>
              )}
            </div>
          </div>

          <div
            style={{
              border: `1px solid ${props.theme.border}`,
              borderRadius: 14,
              padding: 12,
              background: props.theme.softBg,
              boxShadow: props.theme.shadow,
            }}
          >
            <div style={{ fontWeight: 900, marginBottom: 6 }}>Theme</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                onClick={() => props.onSetThemeMode("dark")}
                style={btnStyle(props.theme, props.themeMode === "dark" ? "primary" : "ghost")}
              >
                Dark
              </button>
              <button
                onClick={() => props.onSetThemeMode("light")}
                style={btnStyle(props.theme, props.themeMode === "light" ? "primary" : "ghost")}
              >
                Light
              </button>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

function EmployeePage(props: {
  theme: Theme;
  employee: Employee;
  stores: string[];
  onBack: () => void;
  onRename: (name: string) => void;
  onAdd: (data: Omit<Infraction, "id">) => void;
}) {
  const [name, setName] = useState(props.employee.name);

  const [type, setType] = useState<InfractionType>("Tardy (16-59 min)");
  const [date, setDate] = useState(todayISO());
  const [store, setStore] = useState(props.stores[0] ?? "");
  const [reason, setReason] = useState("");

  const [showPolicy, setShowPolicy] = useState(false);

  useEffect(() => {
    setName(props.employee.name);
  }, [props.employee.name]);

  const points = useMemo(() => pointsForType(type), [type]);
  const total = useMemo(() => sumPoints(props.employee.infractions), [props.employee.infractions]);
  const status = useMemo(() => statusForPoints(total), [total]);
  const tone = useMemo(() => toneForStatus(status), [status]);

  return (
    <div style={{ maxWidth: 980, margin: "0 auto" }}>
      <button onClick={props.onBack} style={btnStyle(props.theme, "ghost")}>
        Back
      </button>

      <Card theme={props.theme}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div style={{ minWidth: 260, flex: "1 1 360px" }}>
            <div style={{ color: props.theme.muted, fontSize: 12, marginBottom: 6 }}>Employee Name</div>
            <input
              value={name}
              onChange={(e) => {
                const v = e.target.value;
                setName(v);
                props.onRename(v);
              }}
              placeholder="Employee name"
              style={inputStyle(props.theme)}
            />
            <div style={{ marginTop: 6, fontSize: 12, color: props.theme.muted }}>Updates automatically</div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", flex: "0 0 auto" }}>
            <StatusPill theme={props.theme} status={status} total={total} tone={tone} />
          </div>
        </div>
      </Card>

      <Card theme={props.theme}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <h3 style={{ margin: 0 }}>Add Infraction</h3>
          <button onClick={() => setShowPolicy((v) => !v)} style={btnStyle(props.theme, "ghost")}>
            {showPolicy ? "Hide Policy Reference" : "View Policy Reference"}
          </button>
        </div>

        {showPolicy && (
          <div
            style={{
              marginTop: 12,
              border: `1px solid ${props.theme.border}`,
              borderRadius: 14,
              padding: 12,
              background: props.theme.softBg,
              boxShadow: props.theme.shadow,
            }}
          >
            <div style={{ fontWeight: 900, marginBottom: 6 }}>Attendance policy reference</div>
            <div style={{ color: props.theme.muted, fontSize: 12, marginBottom: 10 }}>
              PRS Wal-Mart Wireless Attendance Policy (Revised May 2025)
            </div>
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
            <span style={{ fontSize: 12, color: props.theme.muted }}>Type</span>
            <select value={type} onChange={(e) => setType(e.target.value as InfractionType)} style={selectStyle(props.theme)}>
              <option value="Call Out (Prior to shift)">Call Out (prior to shift) — 3 pts</option>
              <option value="Call Out (After shift starts)">Call Out (after shift starts) — 8 pts</option>
              <option value="No Call / No Show">No Call / No Show — 8 pts</option>
              <option value="Tardy (16-59 min)">Tardy (over 15 min, under 1 hr) — 1 pt</option>
              <option value="Tardy (60+ min)">Tardy (over 1 hr) — 2 pts</option>
              <option value="Early Departure (16-59 min)">Early Departure (over 15 min, under 1 hr) — 1 pt</option>
              <option value="Early Departure (60+ min)">Early Departure (over 1 hr) — 2 pts</option>
              <option value="Late Return (16-59 min)">Late Return (over 15 min, under 1 hr) — 1 pt</option>
              <option value="Late Return (60+ min)">Late Return (over 1 hr) — 2 pts</option>
            </select>
          </label>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, color: props.theme.muted }}>Date</span>
              <input value={date} type="date" onChange={(e) => setDate(e.target.value)} style={inputStyle(props.theme)} />
            </label>

            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, color: props.theme.muted }}>Scheduled Store</span>
              <select value={store} onChange={(e) => setStore(e.target.value)} style={selectStyle(props.theme)}>
                {props.stores.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 12, color: props.theme.muted }}>Reason (optional)</span>
            <textarea
              placeholder="Reason / notes (optional)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              style={textareaStyle(props.theme)}
            />
          </label>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <div style={{ color: props.theme.muted, fontSize: 13 }}>
              Points: <strong style={{ color: props.theme.text }}>{points}</strong>
            </div>
            <button
              onClick={() => {
                props.onAdd({ type, date, store, points, reason });
                setReason("");
              }}
              style={btnStyle(props.theme, "primary")}
            >
              Add Infraction
            </button>
          </div>
        </div>
      </Card>

      <Card theme={props.theme}>
        <h3 style={{ marginTop: 0 }}>Infractions</h3>
        {props.employee.infractions.length === 0 ? (
          <div style={{ color: props.theme.muted }}>No infractions yet.</div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {props.employee.infractions.map((i) => (
              <div
                key={i.id}
                style={{
                  border: `1px solid ${props.theme.border}`,
                  borderRadius: 14,
                  padding: 12,
                  background: props.theme.softBg,
                  boxShadow: props.theme.shadow,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ fontWeight: 900 }}>{i.type}</div>
                  <div style={{ color: props.theme.muted }}>{i.points} pts</div>
                </div>
                <div style={{ marginTop: 6, color: props.theme.muted, fontSize: 13 }}>
                  {i.date} • Store: {i.store}
                  {i.reason ? ` • Reason: ${i.reason}` : ""}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function StatusPill(props: { theme: Theme; status: string; total: number; tone: BadgeTone }) {
  const colors: Record<BadgeTone, { border: string; bg: string; fg: string }> = {
    neutral: { border: props.theme.border, bg: props.theme.softBg, fg: props.theme.text },
    ok: { border: props.theme.ok, bg: "rgba(34,197,94,0.12)", fg: props.theme.ok },
    warn: { border: props.theme.warn, bg: "rgba(245,158,11,0.12)", fg: props.theme.warn },
    danger: { border: props.theme.danger, bg: "rgba(239,68,68,0.12)", fg: props.theme.danger },
  };

  const s = colors[props.tone];

  return (
    <div
      style={{
        border: `2px solid ${s.border}`,
        background: s.bg,
        color: s.fg,
        borderRadius: 999,
        padding: "10px 14px",
        fontWeight: 900,
        fontSize: 16,
        display: "flex",
        alignItems: "center",
        gap: 10,
        minHeight: 44,
      }}
      title="Attendance Status"
    >
      <span style={{ color: props.theme.muted, fontSize: 12, fontWeight: 800 }}>Status</span>
      <span>{props.status}</span>
      <span style={{ color: props.theme.text, opacity: 0.5 }}>•</span>
      <span style={{ color: props.theme.text }}>{props.total} pts</span>
    </div>
  );
}

function Card(props: { theme: Theme; children: React.ReactNode }) {
  return (
    <div
      style={{
        border: `1px solid ${props.theme.border}`,
        borderRadius: 16,
        padding: 14,
        margin: "12px 0",
        background: props.theme.card,
        boxShadow: props.theme.shadow,
      }}
    >
      {props.children}
    </div>
  );
}

function inputStyle(theme: Theme): React.CSSProperties {
  return {
    width: 260,
    maxWidth: "100%",
    padding: 10,
    borderRadius: 12,
    border: `1px solid ${theme.border}`,
    background: theme.inputBg,
    color: theme.text,
    outline: "none",
  };
}

function selectStyle(theme: Theme): React.CSSProperties {
  return {
    width: "100%",
    padding: 10,
    borderRadius: 12,
    border: `1px solid ${theme.border}`,
    background: theme.inputBg,
    color: theme.text,
    outline: "none",
  };
}

function textareaStyle(theme: Theme): React.CSSProperties {
  return {
    width: "100%",
    padding: 10,
    minHeight: 70,
    borderRadius: 12,
    border: `1px solid ${theme.border}`,
    background: theme.inputBg,
    color: theme.text,
    outline: "none",
    resize: "vertical",
  };
}

function btnStyle(theme: Theme, kind: "primary" | "ghost" | "danger"): React.CSSProperties {
  const base: React.CSSProperties = {
    padding: "10px 12px",
    borderRadius: 12,
    border: `1px solid ${theme.border}`,
    fontWeight: 900,
    cursor: "pointer",
    background: theme.softBg,
    color: theme.text,
  };

  if (kind === "primary")
    return { ...base, background: theme.primary, border: `1px solid ${theme.primary}`, color: "#00111a" };
  if (kind === "danger")
    return { ...base, background: theme.danger, border: `1px solid ${theme.danger}`, color: "#0b0b0b" };
  return base;
}

function ConfirmDialog(props: { theme: Theme; state: Extract<ConfirmState, { open: true }>; onCancel: () => void }) {
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
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) props.onCancel();
      }}
    >
      <div
        style={{
          background: props.theme.card,
          border: `1px solid ${props.theme.border}`,
          borderRadius: 16,
          padding: 16,
          width: "100%",
          maxWidth: 420,
          boxShadow: props.theme.shadow,
        }}
      >
        <div style={{ fontWeight: 900, fontSize: 16 }}>{s.title}</div>
        <p style={{ color: props.theme.muted, marginTop: 8 }}>{s.message}</p>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={props.onCancel} style={btnStyle(props.theme, "ghost")}>
            Cancel
          </button>
          <button onClick={s.onConfirm} style={btnStyle(props.theme, s.danger ? "danger" : "primary")}>
            {s.confirmText ?? "OK"}
          </button>
        </div>
      </div>
    </div>
  );
}
