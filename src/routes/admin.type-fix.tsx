import { createFileRoute } from "@tanstack/react-router";
import { AuthGate } from "@/components/AuthGate";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  adminListTypeSuspects,
  adminApproveTypeFix,
  adminRejectTypeSuspect,
} from "@/lib/admin-type-fix.functions";

export const Route = createFileRoute("/admin/type-fix")({
  ssr: false,
  component: () => (
    <AuthGate>
      <AdminTypeFix />
    </AuthGate>
  ),
});

function AdminTypeFix() {
  const listFn = useServerFn(adminListTypeSuspects);
  const approveFn = useServerFn(adminApproveTypeFix);
  const rejectFn = useServerFn(adminRejectTypeSuspect);
  const qc = useQueryClient();

  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [bulkBusy, setBulkBusy] = useState(false);

  const q = useQuery({
    queryKey: ["adm-typefix", "list"],
    queryFn: () => listFn(),
    staleTime: 30_000,
  });

  const notAuthed = q.error && /Not authorized/i.test((q.error as Error).message);

  const approve = useMutation({
    mutationFn: (v: { bottleId: string; newType: string }) =>
      approveFn({ data: { bottleId: v.bottleId, newType: v.newType } }),
    onSuccess: (r) => {
      if (r.noop) {
        toast.info("Already the target type — no change");
      } else {
        toast.success(`Approved: ${r.oldType} → ${r.newType}`);
      }
      setChecked((c) => {
        const n = { ...c };
        delete n[r.bottleId];
        return n;
      });
      qc.invalidateQueries({ queryKey: ["adm-typefix", "list"] });
    },
    onError: (e: any) => toast.error(e?.message ?? String(e)),
  });

  const reject = useMutation({
    mutationFn: (bottleId: string) => rejectFn({ data: { bottleId } }),
    onSuccess: (r) => {
      toast.success("Rejected — hidden from queue");
      setChecked((c) => {
        const n = { ...c };
        delete n[r.bottleId];
        return n;
      });
      qc.invalidateQueries({ queryKey: ["adm-typefix", "list"] });
    },
    onError: (e: any) => toast.error(e?.message ?? String(e)),
  });

  const suspects = q.data ?? [];
  const selectedIds = useMemo(
    () => suspects.filter((s) => checked[s.id]).map((s) => s.id),
    [suspects, checked],
  );

  async function bulkApprove() {
    if (selectedIds.length === 0) return;
    if (!confirm(`Approve ${selectedIds.length} type fixes?`)) return;
    setBulkBusy(true);
    let ok = 0;
    let fail = 0;
    for (const s of suspects.filter((s) => checked[s.id])) {
      try {
        await approveFn({ data: { bottleId: s.id, newType: s.proposedType } });
        ok++;
      } catch (e: any) {
        fail++;
        toast.error(`${s.name}: ${e?.message ?? String(e)}`);
      }
    }
    setBulkBusy(false);
    setChecked({});
    qc.invalidateQueries({ queryKey: ["adm-typefix", "list"] });
    toast.success(`Bulk approve: ${ok} ok, ${fail} failed`);
  }

  if (notAuthed) {
    return (
      <div style={{ padding: 24, fontFamily: "system-ui" }}>
        <p>Not found.</p>
      </div>
    );
  }

  const allChecked = suspects.length > 0 && suspects.every((s) => checked[s.id]);

  return (
    <div style={{ padding: 20, fontFamily: "system-ui", maxWidth: 1200 }}>
      <h1 style={{ fontSize: 20, marginBottom: 4 }}>Type mislabel review</h1>
      <p style={{ opacity: 0.65, fontSize: 12, marginBottom: 16 }}>
        Detects rows where <code>type='rose'</code> + red grape and the name has no rosé/blush/white
        token (plus the mirror <code>type='red'</code> + name says Blanc de Noir / Vin Gris / White X / Clairet).
        Fingerprints are untouched. Approve writes <code>bottles.type</code> and appends a{" "}
        <code>catalog_corrections</code> audit row.
      </p>

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, opacity: 0.7 }}>
          {q.isFetching ? "Loading…" : `${suspects.length} suspect${suspects.length === 1 ? "" : "s"}`}
          {selectedIds.length > 0 && ` · ${selectedIds.length} selected`}
        </span>
        <button
          onClick={bulkApprove}
          disabled={selectedIds.length === 0 || bulkBusy}
          style={{ ...btn, background: "#111", color: "#fff", borderColor: "#111" }}
        >
          {bulkBusy ? "Approving…" : `Bulk approve selected (${selectedIds.length})`}
        </button>
        <button onClick={() => q.refetch()} style={btn}>Refresh</button>
      </div>

      {q.error && !notAuthed && (
        <div style={{ color: "#c33", fontSize: 12, marginBottom: 8 }}>
          {(q.error as Error).message}
        </div>
      )}

      <div style={{ border: "1px solid #eee", borderRadius: 6, overflow: "auto", maxHeight: "70vh" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead style={{ background: "#fafafa", position: "sticky", top: 0 }}>
            <tr>
              <th style={{ ...cellHead, width: 32 }}>
                <input
                  type="checkbox"
                  checked={allChecked}
                  onChange={(e) => {
                    const c: Record<string, boolean> = {};
                    if (e.target.checked) for (const s of suspects) c[s.id] = true;
                    setChecked(c);
                  }}
                />
              </th>
              <th style={cellHead}>name</th>
              <th style={cellHead}>producer</th>
              <th style={cellHead}>grape</th>
              <th style={cellHead}>region</th>
              <th style={cellHead}>current → proposed</th>
              <th style={cellHead}>reason</th>
              <th style={cellHead}></th>
            </tr>
          </thead>
          <tbody>
            {suspects.length === 0 && !q.isFetching && (
              <tr>
                <td style={cell} colSpan={8}>
                  <span style={{ opacity: 0.5 }}>Queue is empty. 🎉</span>
                </td>
              </tr>
            )}
            {suspects.map((s) => (
              <tr key={s.id} style={{ borderTop: "1px solid #f0f0f0" }}>
                <td style={cell}>
                  <input
                    type="checkbox"
                    checked={!!checked[s.id]}
                    onChange={(e) => setChecked((c) => ({ ...c, [s.id]: e.target.checked }))}
                  />
                </td>
                <td style={cell}><strong>{s.name}</strong></td>
                <td style={cell}>{s.producer ?? "—"}</td>
                <td style={cell}>{s.grape ?? "—"}</td>
                <td style={cell}>{s.region ?? "—"}</td>
                <td style={cell}>
                  <code>{s.currentType}</code> → <code>{s.proposedType}</code>
                </td>
                <td style={{ ...cell, maxWidth: 320, opacity: 0.75 }}>{s.reason}</td>
                <td style={cell}>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button
                      onClick={() => approve.mutate({ bottleId: s.id, newType: s.proposedType })}
                      disabled={approve.isPending}
                      style={{ ...btn, padding: "3px 10px", fontSize: 11, background: "#111", color: "#fff", borderColor: "#111" }}
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => reject.mutate(s.id)}
                      disabled={reject.isPending}
                      style={{ ...btn, padding: "3px 10px", fontSize: 11 }}
                    >
                      Reject
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const btn: React.CSSProperties = {
  fontSize: 12,
  padding: "5px 12px",
  border: "1px solid #333",
  borderRadius: 6,
  background: "#fff",
  cursor: "pointer",
};
const cellHead: React.CSSProperties = {
  textAlign: "left",
  padding: "6px 8px",
  fontSize: 11,
  fontWeight: 600,
  opacity: 0.75,
  borderBottom: "1px solid #eee",
};
const cell: React.CSSProperties = { padding: "5px 8px", verticalAlign: "top" };
