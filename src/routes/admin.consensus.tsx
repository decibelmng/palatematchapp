import { createFileRoute } from "@tanstack/react-router";
import { AuthGate } from "@/components/AuthGate";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import {
  adminConsensusStatus,
  adminConsensusScan,
  adminConsensusValidate,
  adminConsensusListShadow,
} from "@/lib/admin-consensus.functions";

export const Route = createFileRoute("/admin/consensus")({
  ssr: false,
  component: () => (
    <AuthGate>
      <AdminConsensus />
    </AuthGate>
  ),
});

const fmt = (v: number | null | undefined, d = 3) =>
  v == null || Number.isNaN(v) ? "—" : Number(v).toFixed(d);

function AdminConsensus() {
  const statusFn = useServerFn(adminConsensusStatus);
  const scanFn = useServerFn(adminConsensusScan);
  const validateFn = useServerFn(adminConsensusValidate);
  const listFn = useServerFn(adminConsensusListShadow);
  const qc = useQueryClient();
  const [lastRun, setLastRun] = useState<any | null>(null);

  const status = useQuery({
    queryKey: ["consensus-status"],
    queryFn: () => statusFn({ data: {} } as any),
  });

  const shadowList = useQuery({
    queryKey: ["consensus-shadow-list"],
    queryFn: () => listFn({ data: {} } as any),
  });

  const scanMut = useMutation({
    mutationFn: (write: boolean) => scanFn({ data: { write } }),
    onSuccess: (r) => {
      setLastRun(r);
      const { summary } = r;
      toast.success(
        `Scan complete · gate ${summary?.global_pass ? "PASS" : "FAIL"} · ${summary?.bottles_eligible ?? 0} bottles · ${summary?.observations_written ?? 0} shadow rows written`,
      );
      qc.invalidateQueries({ queryKey: ["consensus-shadow-list"] });
      qc.invalidateQueries({ queryKey: ["consensus-status"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Scan failed"),
  });

  const validateMut = useMutation({
    mutationFn: (observationId: string) => validateFn({ data: { observationId } }),
    onSuccess: (r) => {
      if (!r) return toast.error("No result");
      toast[r.promoted ? "success" : "message"](
        `${r.promoted ? "Promoted" : "Not promoted"} · reason=${r.reason} · err_prior=${fmt(r.err_prior)} err_shadow=${fmt(r.err_shadow)} n_test=${r.n_test}`,
      );
      qc.invalidateQueries({ queryKey: ["consensus-shadow-list"] });
      qc.invalidateQueries({ queryKey: ["consensus-status"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Validate failed"),
  });

  const gate = status.data?.gate;
  const drift = status.data?.drift;

  return (
    <div className="max-w-5xl mx-auto p-4 pb-32 space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Consensus engine · shadow</h1>
        <p className="text-sm text-muted-foreground">
          Build-to-shadow correction plumbing. At current volume, all gates fail
          and nothing writes to live fp_*.
        </p>
      </header>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-lg border p-4 space-y-2">
          <div className="text-sm font-medium">Global gate</div>
          {status.isLoading || !gate ? (
            <div className="text-sm text-muted-foreground">loading…</div>
          ) : (
            <dl className="text-sm grid grid-cols-2 gap-1">
              <dt>Total ratings</dt>
              <dd className="text-right tabular-nums">
                {gate.total_ratings} / {gate.min_ratings}
              </dd>
              <dt>Distinct users</dt>
              <dd className="text-right tabular-nums">
                {gate.distinct_users} / {gate.min_users}
              </dd>
              <dt>Gate</dt>
              <dd
                className={`text-right font-semibold ${
                  gate.global_pass ? "text-emerald-600" : "text-amber-600"
                }`}
              >
                {gate.global_pass ? "PASS" : "FAIL — dormant"}
              </dd>
            </dl>
          )}
        </div>

        <div className="rounded-lg border p-4 space-y-2">
          <div className="text-sm font-medium">Drift monitor</div>
          {status.isLoading || !drift ? (
            <div className="text-sm text-muted-foreground">loading…</div>
          ) : (
            <dl className="text-sm grid grid-cols-2 gap-1">
              <dt>Bottles</dt>
              <dd className="text-right tabular-nums">{drift.n_bottles}</dd>
              <dt>Σ ‖fp − prior‖</dt>
              <dd className="text-right tabular-nums">{fmt(drift.drift_sum)}</dd>
              <dt>max</dt>
              <dd className="text-right tabular-nums">{fmt(drift.drift_max)}</dd>
              <dt>p95</dt>
              <dd className="text-right tabular-nums">{fmt(drift.drift_p95)}</dd>
              <dt>moved (&gt;1e-4)</dt>
              <dd className="text-right tabular-nums">{drift.n_moved}</dd>
            </dl>
          )}
        </div>
      </section>

      <section className="rounded-lg border p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">Consensus scan</div>
            <div className="text-xs text-muted-foreground">
              Dry-run prints candidates but writes nothing. Write mode appends
              shadow observations only when gates pass — the live recompute
              ignores shadow rows.
            </div>
          </div>
          <div className="flex gap-2">
            <button
              className="rounded border px-3 py-1.5 text-sm"
              onClick={() => scanMut.mutate(false)}
              disabled={scanMut.isPending}
            >
              Dry run
            </button>
            <button
              className="rounded border px-3 py-1.5 text-sm"
              onClick={() => scanMut.mutate(true)}
              disabled={scanMut.isPending}
            >
              Scan &amp; write shadow
            </button>
          </div>
        </div>
        {lastRun?.summary && (
          <div className="text-xs text-muted-foreground">
            run={lastRun.summary.run_id.slice(0, 8)} · gate=
            {String(lastRun.summary.global_pass)} · bottles=
            {lastRun.summary.bottles_eligible} · axes=
            {lastRun.summary.axes_evaluated} · written=
            {lastRun.summary.observations_written}
          </div>
        )}
        {lastRun?.candidates?.length > 0 && (
          <div className="overflow-auto max-h-80 border rounded">
            <table className="text-xs w-full">
              <thead className="bg-muted sticky top-0">
                <tr>
                  <th className="p-1 text-left">bottle</th>
                  <th className="p-1 text-left">axis</th>
                  <th className="p-1 text-right">n</th>
                  <th className="p-1 text-right">palates</th>
                  <th className="p-1 text-right">mean e</th>
                  <th className="p-1 text-right">sign</th>
                  <th className="p-1 text-right">prior→prop</th>
                  <th className="p-1 text-left">reason</th>
                </tr>
              </thead>
              <tbody>
                {lastRun.candidates.map((c: any) => (
                  <tr key={c.id} className={c.eligible ? "bg-emerald-50/40" : ""}>
                    <td className="p-1 font-mono">{c.bottle_id.slice(0, 8)}</td>
                    <td className="p-1">{c.axis}</td>
                    <td className="p-1 text-right tabular-nums">{c.n_raters}</td>
                    <td className="p-1 text-right tabular-nums">{c.n_palate_codes}</td>
                    <td className="p-1 text-right tabular-nums">{fmt(c.mean_residual)}</td>
                    <td className="p-1 text-right tabular-nums">{fmt(c.sign_consistency, 2)}</td>
                    <td className="p-1 text-right tabular-nums">
                      {fmt(c.prior_value)} → {fmt(c.proposed_value)}
                    </td>
                    <td className="p-1">{c.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-lg border p-4 space-y-3">
        <div className="text-sm font-medium">
          Shadow observations ({shadowList.data?.length ?? 0})
        </div>
        {shadowList.data && shadowList.data.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            No consensus observations yet — expected until gates pass.
          </div>
        ) : (
          <div className="overflow-auto max-h-96 border rounded">
            <table className="text-xs w-full">
              <thead className="bg-muted sticky top-0">
                <tr>
                  <th className="p-1 text-left">created</th>
                  <th className="p-1 text-left">bottle</th>
                  <th className="p-1 text-left">axis</th>
                  <th className="p-1 text-right">value</th>
                  <th className="p-1 text-left">mode</th>
                  <th className="p-1 text-left">superseded</th>
                  <th className="p-1"></th>
                </tr>
              </thead>
              <tbody>
                {(shadowList.data ?? []).map((o: any) => (
                  <tr key={o.id}>
                    <td className="p-1 font-mono whitespace-nowrap">
                      {new Date(o.created_at).toISOString().slice(0, 16)}
                    </td>
                    <td className="p-1 font-mono">{o.bottle_id.slice(0, 8)}</td>
                    <td className="p-1">{o.axis}</td>
                    <td className="p-1 text-right tabular-nums">
                      {fmt(o.observed_value)}
                    </td>
                    <td className="p-1">{o.mode}</td>
                    <td className="p-1">{String(o.superseded)}</td>
                    <td className="p-1 text-right">
                      {o.mode === "shadow" && !o.superseded && (
                        <button
                          className="rounded border px-2 py-0.5"
                          onClick={() => validateMut.mutate(o.id)}
                          disabled={validateMut.isPending}
                        >
                          Validate
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
