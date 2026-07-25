import { createFileRoute } from "@tanstack/react-router";
import { AuthGate } from "@/components/AuthGate";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  adminListTables,
  adminGetColumns,
  adminGetRows,
} from "@/lib/admin-inspect.functions";

export const Route = createFileRoute("/admin/inspect")({
  ssr: false,
  component: () => (
    <AuthGate>
      <AdminInspect />
    </AuthGate>
  ),
});

const FOCUS = new Set(["bottles", "ratings"]);

function toCSV(rows: any[]): string {
  if (rows.length === 0) return "";
  const keys = Array.from(
    rows.reduce((s: Set<string>, r) => {
      Object.keys(r ?? {}).forEach((k) => s.add(k));
      return s;
    }, new Set<string>()),
  );
  const esc = (v: any) => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [keys.join(","), ...rows.map((r) => keys.map((k) => esc(r[k])).join(","))].join("\n");
}

function AdminInspect() {
  const listFn = useServerFn(adminListTables);
  const colsFn = useServerFn(adminGetColumns);
  const rowsFn = useServerFn(adminGetRows);

  const [selected, setSelected] = useState<string | null>(null);
  const [limit, setLimit] = useState(100);
  const [status, setStatus] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);
  const [fallback, setFallback] = useState<string | null>(null);

  const tables = useQuery({
    queryKey: ["admin-inspect", "tables"],
    queryFn: () => listFn(),
    staleTime: 60_000,
  });

  const cols = useQuery({
    queryKey: ["admin-inspect", "cols", selected],
    queryFn: () => colsFn({ data: { table: selected! } }),
    enabled: !!selected,
    staleTime: 60_000,
  });

  const rows = useQuery({
    queryKey: ["admin-inspect", "rows", selected, limit],
    queryFn: () => rowsFn({ data: { table: selected!, limit } }),
    enabled: !!selected,
  });

  const err = tables.error ?? cols.error ?? rows.error;
  const notAuthed = err && /Not authorized/i.test((err as Error).message);

  if (notAuthed) {
    return (
      <div style={{ padding: 24, fontFamily: "system-ui" }}>
        <p>Not found.</p>
      </div>
    );
  }

  const rowKeys = useMemo(() => {
    const r = rows.data ?? [];
    if (r.length === 0) return (cols.data ?? []).map((c) => c.column_name);
    const s = new Set<string>();
    for (const row of r) Object.keys(row ?? {}).forEach((k) => s.add(k));
    if (cols.data && cols.data.length) {
      const schemaOrder = cols.data.map((c) => c.column_name).filter((k) => s.has(k));
      const extras = Array.from(s).filter((k) => !schemaOrder.includes(k));
      return [...schemaOrder, ...extras];
    }
    return Array.from(s);
  }, [rows.data, cols.data]);

  const inlineJSON = useMemo(
    () => (rows.data ? JSON.stringify(rows.data, null, 2) : ""),
    [rows.data],
  );

  function flash(kind: "ok" | "err", msg: string) {
    setStatus({ kind, msg });
    window.setTimeout(() => setStatus(null), 3500);
  }

  function legacyCopy(text: string): boolean {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.top = "0";
      ta.style.left = "0";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, text.length);
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }

  async function copyPayload(kind: "json" | "csv") {
    const data = rows.data;
    if (!data) {
      flash("err", "No rows loaded yet");
      return;
    }
    const text = kind === "json" ? JSON.stringify(data, null, 2) : toCSV(data);
    const n = data.length;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        flash("ok", `Copied ${n} rows as ${kind.toUpperCase()} (${text.length} chars)`);
        setFallback(null);
        return;
      }
      throw new Error("clipboard API unavailable");
    } catch (e) {
      console.error("[admin-inspect] clipboard failed", e);
      if (legacyCopy(text)) {
        flash("ok", `Copied ${n} rows as ${kind.toUpperCase()} (fallback)`);
        setFallback(null);
      } else {
        setFallback(text);
        flash("err", `Copy failed — select the text below and copy manually`);
      }
    }
  }

  return (
    <div style={{ padding: 20, fontFamily: "system-ui", maxWidth: 1200 }}>
      <h1 style={{ fontSize: 20, marginBottom: 4 }}>Data inspector</h1>
      <p style={{ opacity: 0.65, fontSize: 12, marginBottom: 16 }}>
        Read-only. Admin access. Focus tables: bottles, ratings.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 20 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, opacity: 0.7, marginBottom: 8 }}>Tables</div>
          {tables.isLoading && <div style={{ opacity: 0.5, fontSize: 13 }}>Loading…</div>}
          {tables.error && !notAuthed && (
            <div style={{ color: "#c33", fontSize: 12 }}>{(tables.error as Error).message}</div>
          )}
          <div style={{ display: "grid", gap: 2 }}>
            {(tables.data ?? []).map((t) => {
              const active = selected === t.table_name;
              const focus = FOCUS.has(t.table_name);
              return (
                <button
                  key={t.table_name}
                  onClick={() => setSelected(t.table_name)}
                  style={{
                    textAlign: "left",
                    padding: "6px 8px",
                    border: "1px solid " + (active ? "#333" : "#ddd"),
                    borderRadius: 6,
                    background: active ? "#f5f5f5" : "transparent",
                    fontSize: 13,
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 8,
                    fontWeight: focus ? 600 : 400,
                    cursor: "pointer",
                  }}
                >
                  <span>
                    {t.table_name}
                    {focus && <span style={{ marginLeft: 6, fontSize: 10, opacity: 0.6 }}>focus</span>}
                  </span>
                  <span style={{ opacity: 0.6, fontFamily: "ui-monospace, monospace" }}>
                    {t.row_count ?? "—"}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ minWidth: 0 }}>
          {!selected && <div style={{ opacity: 0.5, fontSize: 13 }}>Select a table to inspect.</div>}
          {selected && (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <div style={{ fontSize: 16, fontWeight: 600 }}>{selected}</div>
                <label style={{ fontSize: 12, opacity: 0.7 }}>
                  Rows:&nbsp;
                  <input
                    type="number"
                    value={limit}
                    min={1}
                    max={500}
                    onChange={(e) => setLimit(Math.min(500, Math.max(1, +e.target.value || 1)))}
                    style={{ width: 64, padding: 2, border: "1px solid #ccc", borderRadius: 4 }}
                  />
                </label>
                <button
                  onClick={() => copyPayload("json")}
                  disabled={!rows.data}
                  style={{ fontSize: 12, padding: "4px 8px", border: "1px solid #999", borderRadius: 4 }}
                >
                  Copy as JSON
                </button>
                <button
                  onClick={() => copyPayload("csv")}
                  disabled={!rows.data}
                  style={{ fontSize: 12, padding: "4px 8px", border: "1px solid #999", borderRadius: 4 }}
                >
                  Copy as CSV
                </button>
                {status && (
                  <span
                    role="status"
                    style={{
                      fontSize: 12,
                      padding: "3px 8px",
                      borderRadius: 4,
                      background: status.kind === "ok" ? "#e6f5ea" : "#fdecec",
                      color: status.kind === "ok" ? "#186a3b" : "#a11a1a",
                      border: "1px solid " + (status.kind === "ok" ? "#bfe3cc" : "#f2c2c2"),
                    }}
                  >
                    {status.msg}
                  </span>
                )}
              </div>
              {fallback !== null && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 11, opacity: 0.75, marginBottom: 4 }}>
                    Clipboard unavailable — select all and copy:
                  </div>
                  <textarea
                    readOnly
                    value={fallback}
                    onFocus={(e) => e.currentTarget.select()}
                    style={{
                      width: "100%",
                      minHeight: 120,
                      fontFamily: "ui-monospace, monospace",
                      fontSize: 11,
                      padding: 8,
                      border: "1px solid #f2c2c2",
                      borderRadius: 6,
                    }}
                  />
                </div>
              )}

              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 600, opacity: 0.7, marginBottom: 4 }}>
                  Schema ({cols.data?.length ?? 0} columns)
                </div>
                <div
                  style={{
                    maxHeight: 200,
                    overflow: "auto",
                    border: "1px solid #eee",
                    borderRadius: 6,
                    fontSize: 12,
                    fontFamily: "ui-monospace, monospace",
                  }}
                >
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead style={{ position: "sticky", top: 0, background: "#fafafa" }}>
                      <tr>
                        <th style={cellHead}>column</th>
                        <th style={cellHead}>type</th>
                        <th style={cellHead}>nullable</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(cols.data ?? []).map((c) => (
                        <tr key={c.column_name} style={{ borderTop: "1px solid #f0f0f0" }}>
                          <td style={cell}>{c.column_name}</td>
                          <td style={cell}>{c.data_type}</td>
                          <td style={cell}>{c.is_nullable}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 600, opacity: 0.7, marginBottom: 4 }}>
                  Sample rows ({rows.data?.length ?? 0})
                </div>
                {rows.isLoading && <div style={{ opacity: 0.5, fontSize: 13 }}>Loading rows…</div>}
                {rows.error && !notAuthed && (
                  <div style={{ color: "#c33", fontSize: 12 }}>{(rows.error as Error).message}</div>
                )}
                {rows.data && (
                  <div
                    style={{
                      overflow: "auto",
                      maxHeight: 560,
                      border: "1px solid #eee",
                      borderRadius: 6,
                      fontSize: 11,
                      fontFamily: "ui-monospace, monospace",
                    }}
                  >
                    <table style={{ borderCollapse: "collapse", minWidth: "100%" }}>
                      <thead style={{ position: "sticky", top: 0, background: "#fafafa" }}>
                        <tr>
                          {rowKeys.map((k) => (
                            <th key={k} style={cellHead}>
                              {k}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.data.map((r, i) => (
                          <tr key={i} style={{ borderTop: "1px solid #f0f0f0" }}>
                            {rowKeys.map((k) => {
                              const v = (r as any)[k];
                              const s =
                                v === null || v === undefined
                                  ? ""
                                  : typeof v === "object"
                                    ? JSON.stringify(v)
                                    : String(v);
                              return (
                                <td key={k} style={{ ...cell, whiteSpace: "nowrap", maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis" }} title={s}>
                                  {s}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const cellHead: React.CSSProperties = {
  textAlign: "left",
  padding: "6px 8px",
  fontWeight: 600,
  fontSize: 11,
  opacity: 0.75,
  borderBottom: "1px solid #eee",
  whiteSpace: "nowrap",
};
const cell: React.CSSProperties = { padding: "4px 8px" };
