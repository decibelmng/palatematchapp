import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AuthGate } from "@/components/AuthGate";
import { Button } from "@/components/ui/button";
import {
  vintageRemediationQueue,
  vintageRematchUnrated,
  vintageConfirmRepoint,
  type RemediationItem,
} from "@/lib/vintage-remediation.functions";

export const Route = createFileRoute("/admin/vintage-remediation")({
  ssr: false,
  component: () => (
    <AuthGate>
      <VintageRemediation />
    </AuthGate>
  ),
});

type Counts = { total: number; unrated: number; confirmExisting: number; confirmResolve: number };

function VintageRemediation() {
  const loadQueue = useServerFn(vintageRemediationQueue);
  const rematchUnrated = useServerFn(vintageRematchUnrated);
  const confirmOne = useServerFn(vintageConfirmRepoint);

  const [items, setItems] = useState<RemediationItem[] | null>(null);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  function refresh() {
    setFatal(null);
    loadQueue()
      .then((r) => {
        setItems(r.items);
        setCounts(r.counts);
      })
      .catch((e) => setFatal(e?.message ?? String(e)));
  }

  useEffect(refresh, []);

  async function runUnrated() {
    setBusy("bulk");
    try {
      const r = await rematchUnrated();
      toast.success(
        `${r.repointed} lines moved to the right year, ${r.unmatched} left unmatched — we don't hold that year.`,
      );
      refresh();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function confirm(i: RemediationItem) {
    setBusy(i.scan_wine_id);
    try {
      const r = await confirmOne({
        data: { scanWineId: i.scan_wine_id, resolveOnDemand: i.klass === "confirm-resolve" },
      });
      const parts = [r.created ? "added the missing year" : "linked the existing year"];
      if (r.movedRating) parts.push("moved the rating");
      if (r.benchmarkRestored) parts.push("re-set the benchmark");
      toast.success(`${i.wrong_name}: ${parts.join(", ")}.`);
      refresh();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const needsConfirm = (items ?? []).filter((i) => i.klass !== "unrated");

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 pb-28">
      <h1 className="text-title text-foreground">Vintage remediation</h1>
      <p className="mt-2 text-sub text-muted-foreground">
        Scan lines that resolved to a bottle from a different year than the list showed. Lines with
        nothing attached are rewritten in bulk. Anything carrying a rating or a benchmark waits for
        you.
      </p>

      {fatal && (
        <p className="mt-4 text-sub text-foreground">
          Couldn't read the queue — {fatal}
        </p>
      )}

      {counts && (
        <div className="pm-card mt-5 p-4">
          <p className="text-sub text-foreground">
            {counts.total} mismatched lines · {counts.unrated} safe to rewrite ·{" "}
            {counts.confirmExisting + counts.confirmResolve} need your confirmation
          </p>
          <Button
            className="mt-3 w-full"
            disabled={busy != null || counts.unrated === 0}
            onClick={runUnrated}
          >
            {busy === "bulk"
              ? "Rewriting…"
              : `Rewrite ${counts.unrated} unrated lines`}
          </Button>
        </div>
      )}

      {items == null && !fatal && (
        <p className="mt-5 text-sub text-muted-foreground">Reading the queue…</p>
      )}

      {needsConfirm.length > 0 && (
        <h2 className="mt-8 text-heading text-foreground">Needs your confirmation</h2>
      )}

      <div className="mt-3 space-y-3">
        {needsConfirm.map((i) => (
          <div key={i.scan_wine_id} className="pm-card p-4">
            <p className="text-sub text-foreground break-words">{i.wrong_name}</p>
            <p className="mt-1 text-meta text-muted-foreground">
              The list said {i.scanned_vintage}; it was scored off the {i.wrong_vintage} —{" "}
              {i.years_apart} {i.years_apart === 1 ? "year" : "years"} apart.
            </p>
            <p className="mt-1 text-meta text-muted-foreground">
              {i.stars != null ? `You rated it ${i.stars}. ` : ""}
              {i.benchmark_tier === "canon" ? "It's one of your Benchmarks. " : ""}
              {i.benchmark_tier === "nemesis" ? "It's one of your Dealbreakers. " : ""}
              {i.klass === "confirm-resolve"
                ? "We don't hold the " + i.scanned_vintage + " yet — confirming adds it."
                : `Moving it to ${i.correct_name}.`}
            </p>
            {i.other_ratings > 0 && (
              <p className="mt-1 text-meta text-muted-foreground">
                Someone else has rated this bottle too. Their rating stays where it is.
              </p>
            )}
            <Button
              variant="outline"
              className="mt-3 w-full"
              disabled={busy != null}
              onClick={() => confirm(i)}
            >
              {busy === i.scan_wine_id
                ? "Moving…"
                : i.klass === "confirm-resolve"
                  ? `Add the ${i.scanned_vintage} and move it`
                  : `Move it to the ${i.scanned_vintage}`}
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
