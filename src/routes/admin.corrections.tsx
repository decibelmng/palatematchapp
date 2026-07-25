import { createFileRoute } from "@tanstack/react-router";
import { AuthGate } from "@/components/AuthGate";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  adminSearchBottlesForCorrection,
  adminGetBottleFingerprint,
  adminSubmitCorrection,
  adminRevertObservation,
  FP_AXES,
  type FpAxis,
} from "@/lib/admin-corrections.functions";

export const Route = createFileRoute("/admin/corrections")({
  ssr: false,
  component: () => (
    <AuthGate>
      <AdminCorrections />
    </AuthGate>
  ),
});

const fmt = (v: number | null | undefined) =>
  v == null ? "—" : Number(v).toFixed(3);

function AdminCorrections() {
  const searchFn = useServerFn(adminSearchBottlesForCorrection);
  const getFn = useServerFn(adminGetBottleFingerprint);
  const submitFn = useServerFn(adminSubmitCorrection);
  const revertFn = useServerFn(adminRevertObservation);
  const qc = useQueryClient();

  const [q, setQ] = useState("");
  const [ranQ, setRanQ] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [rationale, setRationale] = useState("");

  const search = useQuery({
    queryKey: ["adm-corr", "search", ranQ],
    queryFn: () => searchFn({ data: { q: ranQ } }),
    enabled: ranQ.length >= 2,
  });

  const detail = useQuery({
    queryKey: ["adm-corr", "detail", selectedId],
    queryFn: () => getFn({ data: { bottleId: selectedId! } }),
    enabled: !!selectedId,
  });

  const notAuthed =
    (search.error && /Not authorized/i.test((search.error as Error).message)) ||
    (detail.error && /Not authorized/i.test((detail.error as Error).message));

  const submit = useMutation({
    mutationFn: async () => {
      if (!selectedId) throw new Error("Select a bottle first");
      const corrections: { axis: FpAxis; value: number }[] = [];
      for (const a of FP_AXES) {
        const raw = drafts[a];
        if (raw == null || raw === "") continue;
        const v = Number(raw);
        if (!Number.isFinite(v)) throw new Error(`Axis ${a}: not a number`);
        corrections.push({ axis: a, value: v });
      }
      if (corrections.length === 0) throw new Error("Enter at least one axis value");
      if (rationale.trim().length < 3) throw new Error("Rationale is required");
      return submitFn({ data: { bottleId: selectedId, rationale: rationale.trim(), corrections } });
    },
    onSuccess: (res) => {
      const moved = res.moves.filter((m) => m.moved);
      toast.success(
        `Submitted ${res.insertedObservationIds.length} observation(s)`,
        {
          description:
            moved.length === 0
              ? "Recompute ran; no axis moved (below evidence floor or capped)."
              : moved
                  .map((m) => `${m.axis}: ${fmt(m.old_value)} → ${fmt(m.new_value)} (Σλ=${fmt(m.sum_lambda)})`)
                  .join(" · "),
        },
      );
      setDrafts({});
      setRationale("");
      qc.invalidateQueries({ queryKey: ["adm-corr", "detail", selectedId] });
    },
    onError: (e: any) => toast.error(e?.message ?? String(e)),
  });

  const revert = useMutation({
    mutationFn: (observationId: string) => revertFn({ data: { observationId } }),
    onSuccess: (res) => {
      const moved = res.moves.filter((m) => m.moved);
      toast.success(`Reverted (${res.revertedAxis})`, {
        description:
          moved.length === 0
            ? "Recompute ran; no axis change."
            : moved
                .map((m) => `${m.axis}: ${fmt(m.old_value)} → ${fmt(m.new_value)}`)
                .join(" · "),
      });
      qc.invalidateQueries({ queryKey: ["adm-corr", "detail", selectedId] });
    },
    onError: (e: any) => toast.error(e?.message ?? String(e)),
  });

  if (notAuthed) {
    return (
      <div style={{ padding: 24, fontFamily: "system-ui" }}>
        <p>Not found.</p>
      </div>
    );
  }

  const bottle = detail.data?.bottle;
  const axes = detail.data?.axes ?? [];
  const observations = detail.data?.observations ?? [];

  const activeByAxis = useMemo(() => {
    const map = new Map<string, number>();
    for (const o of observations) if (!o.superseded && o.mode === "live") {
      map.set(o.axis, (map.get(o.axis) ?? 0) + 1);
    }
    return map;
  }, [observations]);

  return (
    <div style={{ padding: 20, fontFamily: "system-ui", maxWidth: 1100 }}>
      <h1 style={{ fontSize: 20, marginBottom: 4 }}>Expert corrections</h1>
      <p style={{ opacity: 0.65, fontSize: 12, marginBottom: 16 }}>
        Admin-only. Writes go to <code>fp_observations</code> only. The recompute job blends with the frozen prior
        (τ₀) and is the sole writer of <code>fp_*</code> / <code>ax_*</code>. Precision = 8, move cap = 0.10 / recompute,
        evidence floor Σλ ≥ 5.
      </p>

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && setRanQ(q.trim())}
          placeholder="Search bottle name or producer…"
          style={{ flex: 1, padding: "6px 8px", border: "1px solid #ccc", borderRadius: 6, fontSize: 13 }}
        />
        <button
          onClick={() => setRanQ(q.trim())}
          disabled={q.trim().length < 2}
          style={btn}
        >
          Search
        </button>
      </div>

      {search.isFetching && <div style={{ opacity: 0.5, fontSize: 12 }}>Searching…</div>}
      {search.data && search.data.length > 0 && (
        <div style={{ border: "1px solid #eee", borderRadius: 6, marginBottom: 16, maxHeight: 180, overflow: "auto" }}>
          {search.data.map((b) => (
            <button
              key={b.id}
              onClick={() => setSelectedId(b.id)}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "6px 10px",
                fontSize: 13,
                background: selectedId === b.id ? "#f5f5f5" : "transparent",
                border: "none",
                borderBottom: "1px solid #f0f0f0",
                cursor: "pointer",
              }}
            >
              <strong>{b.name}</strong>
              <span style={{ opacity: 0.65 }}>
                {" · "}{b.producer || "—"} · {b.region || "—"} · {b.vintage || "NV"} · {b.type}
              </span>
            </button>
          ))}
        </div>
      )}

      {detail.isLoading && <div style={{ opacity: 0.5, fontSize: 13 }}>Loading bottle…</div>}
      {detail.error && !notAuthed && (
        <div style={{ color: "#c33", fontSize: 12 }}>{(detail.error as Error).message}</div>
      )}

      {bottle && (
        <>
          <div style={{ marginTop: 4, marginBottom: 12 }}>
            <div style={{ fontSize: 16, fontWeight: 600 }}>{bottle.name}</div>
            <div style={{ fontSize: 12, opacity: 0.7 }}>
              {bottle.producer || "—"} · {bottle.region || "—"} · {bottle.vintage || "NV"} · {bottle.type} ·
              τ₀ = {fmt(bottle.fp_prior_precision)}
            </div>
          </div>

          <div style={{ overflow: "auto", border: "1px solid #eee", borderRadius: 6, marginBottom: 12 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead style={{ background: "#fafafa" }}>
                <tr>
                  <th style={cellHead}>axis</th>
                  <th style={cellHead}>prior μ₀</th>
                  <th style={cellHead}>live μ</th>
                  <th style={cellHead}>active obs</th>
                  <th style={cellHead}>corrected value</th>
                </tr>
              </thead>
              <tbody>
                {axes.map((a) => (
                  <tr key={a.axis} style={{ borderTop: "1px solid #f0f0f0" }}>
                    <td style={cell}><strong>{a.axis}</strong></td>
                    <td style={cell}>{fmt(a.prior)}</td>
                    <td style={cell}>
                      <span style={{ fontWeight: Math.abs((a.live ?? 0) - (a.prior ?? 0)) > 0.001 ? 600 : 400 }}>
                        {fmt(a.live)}
                      </span>
                    </td>
                    <td style={cell}>{activeByAxis.get(a.axis) ?? 0}</td>
                    <td style={cell}>
                      <input
                        type="number"
                        step={0.05}
                        min={0}
                        max={1}
                        value={drafts[a.axis] ?? ""}
                        onChange={(e) => setDrafts((d) => ({ ...d, [a.axis]: e.target.value }))}
                        placeholder="0.00–1.00"
                        style={{ width: 90, padding: 3, border: "1px solid #ccc", borderRadius: 4, fontSize: 12 }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 12, fontWeight: 600, display: "block", marginBottom: 4 }}>
              Rationale (required)
            </label>
            <textarea
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              placeholder="e.g. tasted 2019 at winery; markedly less oak and more acid than default profile"
              style={{ width: "100%", minHeight: 60, padding: 6, border: "1px solid #ccc", borderRadius: 6, fontSize: 12 }}
            />
          </div>

          <button
            onClick={() => submit.mutate()}
            disabled={submit.isPending}
            style={{ ...btn, background: "#111", color: "#fff", borderColor: "#111" }}
          >
            {submit.isPending ? "Submitting…" : "Submit correction"}
          </button>

          <div style={{ marginTop: 20 }}>
            <div style={{ fontSize: 12, fontWeight: 600, opacity: 0.7, marginBottom: 4 }}>
              Observation history ({observations.length})
            </div>
            <div style={{ border: "1px solid #eee", borderRadius: 6, maxHeight: 400, overflow: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, fontFamily: "ui-monospace, monospace" }}>
                <thead style={{ background: "#fafafa", position: "sticky", top: 0 }}>
                  <tr>
                    <th style={cellHead}>when</th>
                    <th style={cellHead}>axis</th>
                    <th style={cellHead}>value</th>
                    <th style={cellHead}>λ</th>
                    <th style={cellHead}>source</th>
                    <th style={cellHead}>mode</th>
                    <th style={cellHead}>state</th>
                    <th style={cellHead}>rationale</th>
                    <th style={cellHead}></th>
                  </tr>
                </thead>
                <tbody>
                  {observations.length === 0 && (
                    <tr>
                      <td style={cell} colSpan={9}>
                        <span style={{ opacity: 0.5 }}>No observations yet.</span>
                      </td>
                    </tr>
                  )}
                  {observations.map((o) => (
                    <tr key={o.id} style={{ borderTop: "1px solid #f0f0f0", opacity: o.superseded ? 0.5 : 1 }}>
                      <td style={cell}>{new Date(o.created_at).toLocaleString()}</td>
                      <td style={cell}>{o.axis}</td>
                      <td style={cell}>{fmt(o.observed_value)}</td>
                      <td style={cell}>{o.precision}</td>
                      <td style={cell}>{o.source_type}</td>
                      <td style={cell}>{o.mode}</td>
                      <td style={cell}>{o.superseded ? "superseded" : "active"}</td>
                      <td style={{ ...cell, maxWidth: 280, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={o.rationale || ""}>
                        {o.rationale || ""}
                      </td>
                      <td style={cell}>
                        {!o.superseded && (
                          <button
                            onClick={() => revert.mutate(o.id)}
                            disabled={revert.isPending}
                            style={{ ...btn, padding: "2px 8px", fontSize: 11 }}
                          >
                            Revert
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
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
