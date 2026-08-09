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
  vintageSettleWithoutMoving,
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
  const settleOne = useServerFn(vintageSettleWithoutMoving);

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

  /** The only answer that writes anything: the list's year is the one poured. */
  async function chooseScanned(i: RemediationItem) {
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

  /** Both no-op answers. Nothing moves; the card just stops asking. */
  async function settle(i: RemediationItem, choice: "current" | "leave") {
    setBusy(i.scan_wine_id);
    try {
      await settleOne({ data: { scanWineId: i.scan_wine_id, choice } });
      toast.success(
        choice === "current"
          ? `Kept on the ${i.wrong_vintage}. Nothing moved.`
          : "Left as it is. Nothing moved.",
      );
      refresh();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const open = (items ?? []).filter((i) => i.klass !== "unrated" && i.settled == null);
  const left = (items ?? []).filter((i) => i.klass !== "unrated" && i.settled === "undecided");

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 pb-28">
      <h1 className="text-title text-foreground">Vintage remediation</h1>
      <p className="mt-2 text-sub text-muted-foreground">
        Scan lines that resolved to a bottle from a different year than the list showed. A scanned
        line is evidence of what the list offered, not proof of what was poured — so anything
        carrying a rating asks you which bottle you drank. Lines with nothing attached are rewritten
        in bulk.
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
            {counts.confirmExisting + counts.confirmResolve} need your answer
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

      {open.length > 0 && <h2 className="mt-8 text-heading text-foreground">Which did you drink?</h2>}

      <div className="mt-3 space-y-3">
        {open.map((i) => (
          <VintageCard
            key={i.scan_wine_id}
            item={i}
            busy={busy === i.scan_wine_id}
            disabled={busy != null}
            onScanned={() => chooseScanned(i)}
            onCurrent={() => settle(i, "current")}
            onLeave={() => settle(i, "leave")}
          />
        ))}
      </div>

      {left.length > 0 && (
        <>
          <h2 className="mt-8 text-heading text-foreground">Left as they are</h2>
          <p className="mt-1 text-meta text-muted-foreground">
            Nothing moved on these. Answer any of them later if you remember the bottle.
          </p>
          <div className="mt-3 space-y-3">
            {left.map((i) => (
              <VintageCard
                key={i.scan_wine_id}
                item={i}
                busy={busy === i.scan_wine_id}
                disabled={busy != null}
                onScanned={() => chooseScanned(i)}
                onCurrent={() => settle(i, "current")}
                onLeave={() => settle(i, "leave")}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * One question, two bottles, three answers. The scanned year is NOT presented as
 * the correction — it is one of two candidates, and the consequence of moving is
 * stated before the tap, never after.
 */
function VintageCard({
  item: i,
  busy,
  disabled,
  onScanned,
  onCurrent,
  onLeave,
}: {
  item: RemediationItem;
  busy: boolean;
  disabled: boolean;
  onScanned: () => void;
  onCurrent: () => void;
  onLeave: () => void;
}) {
  const listedName = [i.scanned_producer ?? i.wrong_producer, i.scanned_cuvee, i.scanned_vintage]
    .filter(Boolean)
    .join(" ");

  // The consequence of a move, in the language of what it changes for you. A
  // plain rating with no anchor role gets no warning — there is nothing to warn
  // about.
  const consequence =
    i.benchmark_tier === "canon"
      ? "This is one of your Benchmarks — moving it changes what your red recommendations anchor to."
      : i.benchmark_tier === "nemesis"
        ? "This is one of your Dealbreakers — moving it changes which wines get vetoed."
        : null;

  return (
    <div className="pm-card p-4">
      {i.stars != null && (
        <p className="text-sub text-foreground">
          You rated this {i.stars} {i.stars === 1 ? "star" : "stars"}.
        </p>
      )}

      <dl className="mt-2 space-y-1">
        <div className="flex gap-2">
          <dt className="w-32 shrink-0 text-meta uppercase tracking-label text-muted-foreground">
            The list showed
          </dt>
          <dd className="text-meta text-foreground break-words">
            {listedName || `the ${i.scanned_vintage}`}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-32 shrink-0 text-meta uppercase tracking-label text-muted-foreground">
            The rating sits on
          </dt>
          <dd className="text-meta text-foreground break-words">{i.wrong_name}</dd>
        </div>
      </dl>

      {consequence && <p className="mt-2 text-meta text-foreground">{consequence}</p>}

      {i.klass === "confirm-resolve" && (
        <p className="mt-2 text-meta text-muted-foreground">
          We don't hold the {i.scanned_vintage} yet — picking it adds that bottle.
        </p>
      )}
      {i.other_ratings > 0 && (
        <p className="mt-2 text-meta text-muted-foreground">
          Someone else has rated this bottle too. Their rating stays where it is.
        </p>
      )}

      <p className="mt-3 text-sub text-foreground">Which did you drink?</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button variant="outline" className="min-h-[44px] flex-1" disabled={disabled} onClick={onScanned}>
          {busy ? "Working…" : `The ${i.scanned_vintage}`}
        </Button>
        <Button variant="outline" className="min-h-[44px] flex-1" disabled={disabled} onClick={onCurrent}>
          The {i.wrong_vintage}
        </Button>
        <Button variant="ghost" className="min-h-[44px] w-full" disabled={disabled} onClick={onLeave}>
          Not sure — leave it
        </Button>
      </div>
    </div>
  );
}

