import { createFileRoute } from "@tanstack/react-router";
import { AuthGate } from "@/components/AuthGate";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { listDisputedFingerprints } from "@/lib/disputes.functions";

export const Route = createFileRoute("/admin/disputes")({
  ssr: false,
  component: () => <AuthGate><AdminDisputes /></AuthGate>,
});

function AdminDisputes() {
  const list = useServerFn(listDisputedFingerprints);
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "fp-disputes"],
    queryFn: () => list(),
    staleTime: 30_000,
  });

  if (isLoading) return <div style={{ padding: 24, fontFamily: "system-ui" }}>Loading…</div>;
  if (error) return <div style={{ padding: 24, fontFamily: "system-ui", color: "#c33" }}>{String((error as Error).message)}</div>;
  const rows = data ?? [];

  return (
    <div style={{ padding: 24, fontFamily: "system-ui", maxWidth: 960 }}>
      <h1 style={{ fontSize: 20, marginBottom: 8 }}>Disputed fingerprints</h1>
      <p style={{ opacity: 0.7, fontSize: 13, marginBottom: 16 }}>
        Bottles where at least one user's rating disagreed with the engine by ≥ 2.5 stars.
        Sorted by (dispute count) × (Σ disputer weights). Canon/Nemesis holders count 3×.
      </p>
      {rows.length === 0 && <div style={{ opacity: 0.5 }}>No active disputes.</div>}
      <div style={{ display: "grid", gap: 16 }}>
        {rows.map((r) => (
          <div key={r.bottle_id} style={{ border: "1px solid #ccc", borderRadius: 8, padding: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{r.name}</div>
                <div style={{ fontSize: 12, opacity: 0.7 }}>
                  {[r.producer, r.region, r.vintage, r.type].filter(Boolean).join(" · ")}
                </div>
              </div>
              <div style={{ fontSize: 12, textAlign: "right" }}>
                <div>score <b>{r.score.toFixed(1)}</b></div>
                <div style={{ opacity: 0.7 }}>{r.dispute_count} × {r.total_weight.toFixed(1)}w</div>
              </div>
            </div>
            <div style={{ marginTop: 8, fontFamily: "ui-monospace, monospace", fontSize: 11, opacity: 0.85 }}>
              fp: fresh {r.fp.fresh.toFixed(2)} · acid {r.fp.acid.toFixed(2)} · tannin {r.fp.tannin.toFixed(2)} ·
              fruit_dark {r.fp.fruit_dark.toFixed(2)} · ripe {r.fp.ripe.toFixed(2)} · oak {r.fp.oak.toFixed(2)} ·
              body {r.fp.body.toFixed(2)} · savory {r.fp.savory.toFixed(2)}
            </div>
            <table style={{ width: "100%", marginTop: 10, fontSize: 12, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left", opacity: 0.6 }}>
                  <th style={{ padding: "4px 8px" }}>User</th>
                  <th style={{ padding: "4px 8px" }}>Stars</th>
                  <th style={{ padding: "4px 8px" }}>Predicted</th>
                  <th style={{ padding: "4px 8px" }}>Δ</th>
                  <th style={{ padding: "4px 8px" }}>Weight</th>
                  <th style={{ padding: "4px 8px" }}>When</th>
                </tr>
              </thead>
              <tbody>
                {r.disputes.map((d) => (
                  <tr key={d.user_id} style={{ borderTop: "1px solid #eee" }}>
                    <td style={{ padding: "4px 8px" }}>
                      {d.username ?? d.user_id.slice(0, 8)}
                      {d.is_anchor_holder && <span style={{ marginLeft: 6, fontSize: 10, opacity: 0.6 }}>anchor</span>}
                    </td>
                    <td style={{ padding: "4px 8px" }}>{d.stars}★</td>
                    <td style={{ padding: "4px 8px" }}>{d.predicted.toFixed(2)}</td>
                    <td style={{ padding: "4px 8px" }}>{d.delta.toFixed(2)}</td>
                    <td style={{ padding: "4px 8px" }}>{d.weight.toFixed(1)}</td>
                    <td style={{ padding: "4px 8px", opacity: 0.6 }}>{new Date(d.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}
