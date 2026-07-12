import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/use-session";
import { ArrowLeft } from "lucide-react";
import { AuthGate } from "@/components/AuthGate";
import { WineTypeBadge } from "@/components/WineTypeBadge";
import { StarTap } from "@/components/StarTap";
import { CanonAction } from "@/components/CanonAction";
import { NemesisAction } from "@/components/NemesisAction";
import { BenchmarkTierBadges } from "@/components/BenchmarkTierBadge";
import { StyleNeighbors } from "@/components/StyleNeighbors";
import {
  useBottlesByIds,
  useRatings,
  useRate,
  bottleType,
  bottleToFp,
  isCalibrated,
} from "@/hooks/use-palate-data";
import { useMyCanons } from "@/hooks/use-canon";
import { cuveeKey, stripVintageFromName } from "@/lib/cuvee";
import { RAX } from "@/lib/recommender";

export const Route = createFileRoute("/wine/$id")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Wine — Palate Match" },
      { name: "description", content: "A wine you've tried, with style neighbors from your palate." },
    ],
  }),
  component: () => <AuthGate><WineDetail /></AuthGate>,
});

function WineDetail() {
  const { id } = Route.useParams();
  const { data: bottles, isLoading } = useBottlesByIds([id]);
  const bottle = bottles?.[0] ?? null;

  const { data: ratings } = useRatings();
  const { data: canons } = useMyCanons();
  const rate = useRate();

  // Cuvée-aware rating: if the user has rated other vintages of this cuvée,
  // show the average as the "subject stars" the neighbors section uses to
  // pick its label. The star tap edits ONLY this bottle's rating.
  const { thisStars, cuveeAvgStars } = useMemo(() => {
    if (!bottle || !ratings) return { thisStars: null as number | null, cuveeAvgStars: null as number | null };
    const thisR = ratings.find((r) => r.bottle_id === bottle.id);
    const thisStars = thisR?.stars ?? null;
    // For cuvée avg, we'd need other bottle rows; fall back to this bottle
    // alone when no vintage siblings are cached.
    const cachedIds = (bottles ?? []).map((b) => b.id);
    void cachedIds;
    return { thisStars, cuveeAvgStars: thisStars };
  }, [bottle, bottles, ratings]);

  if (isLoading) {
    return <p className="pt-4 text-sm text-muted-foreground">Loading…</p>;
  }
  if (!bottle) {
    return (
      <div className="pt-4">
        <p className="text-sm text-muted-foreground">Wine not found.</p>
        <Link to="/rate" className="mt-3 inline-block text-sm text-primary underline">← Back</Link>
      </div>
    );
  }

  const type = bottleType(bottle);
  const displayName = stripVintageFromName(bottle.name);
  const meta = [bottle.producer, bottle.region, bottle.grape].filter(Boolean).join(" · ");
  const key = cuveeKey(bottle);
  void key;
  const calibrated = isCalibrated(bottle);
  const fp = bottleToFp(bottle);

  return (
    <div className="pt-2">
      <Link
        to="/rate"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft size={14} /> Back to ratings
      </Link>

      <div className="mt-4">
        <div className="flex items-center gap-2 flex-wrap">
          <WineTypeBadge type={type} />
          <BenchmarkTierBadges benchmarks={canons ?? []} bottleIds={[bottle.id]} />
        </div>
        <h1 className="font-serif text-3xl mt-2">{displayName}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {meta}{bottle.vintage ? <span> · {bottle.vintage}</span> : null}
        </p>
      </div>

      <div className="mt-6 flex items-start justify-between gap-4 rounded-xl border border-border bg-card/60 p-4">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Your rating</p>
          <div className="mt-2">
            <StarTap
              value={thisStars}
              onChange={(s) => rate.mutate({ bottleId: bottle.id, stars: s })}
            />
          </div>
          <div className="mt-3 flex flex-col gap-1.5">
            <CanonAction bottle={bottle} stars={thisStars ?? 0} />
            <NemesisAction bottle={bottle} stars={thisStars ?? 0} />
          </div>
        </div>
        {calibrated && (
          <div className="shrink-0 max-w-[55%]">
            <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Fingerprint</p>
            <div className="mt-2 space-y-1">
              {RAX.map((k) => {
                const v = fp[k];
                const pct = Math.max(0, Math.min(100, ((v + 1) / 2) * 100));
                return (
                  <div key={k} className="flex items-center gap-2 text-[11px]">
                    <span className="w-16 text-muted-foreground shrink-0">{k}</span>
                    <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-primary/70" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="w-10 text-right text-muted-foreground tabular-nums">
                      {v.toFixed(2)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <RatingNoteEditor bottleId={bottle.id} rated={thisStars != null} />

      {bottle.tasting_note && (
        <div className="mt-4 rounded border-l-2 border-border pl-3 py-1">
          <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/80">Catalog note</p>
          <p className="text-sm text-muted-foreground leading-snug mt-0.5">{bottle.tasting_note}</p>
        </div>
      )}

      <StyleNeighbors subjectBottleId={bottle.id} subjectStars={cuveeAvgStars} />
    </div>
  );
}

function RatingNoteEditor({ bottleId, rated }: { bottleId: string; rated: boolean }) {
  const session = useSession();
  const qc = useQueryClient();
  const { data: ratings } = useRatings();
  const note = ratings?.find((r) => r.bottle_id === bottleId)?.note ?? null;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  if (!rated || !session) return null;

  async function save() {
    if (!session) return;
    const value = draft.trim();
    const { error } = await supabase
      .from("ratings")
      .update({ note: value || null })
      .eq("user_id", session.user.id)
      .eq("bottle_id", bottleId);
    if (error) { console.error(error); return; }
    setEditing(false);
    setDraft("");
    qc.invalidateQueries({ queryKey: ["ratings"] });
  }

  return (
    <div className="mt-4">
      <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Your note</p>
      {note && !editing && (
        <div className="mt-1 rounded border-l-2 border-primary/40 pl-3 py-1">
          <p className="text-sm italic text-muted-foreground leading-snug">"{note}"</p>
        </div>
      )}
      {!editing ? (
        <button
          className="mt-1.5 text-xs text-primary underline"
          onClick={() => { setEditing(true); setDraft(note ?? ""); }}
        >
          {note ? "edit note" : "+ add your note"}
        </button>
      ) : (
        <div className="mt-1.5">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            placeholder="Your tasting impression…"
            className="w-full bg-input border border-border rounded-md px-2 py-1 text-sm"
          />
          <div className="flex gap-3 mt-1.5">
            <button onClick={() => setEditing(false)} className="text-xs text-muted-foreground underline">cancel</button>
            <button onClick={save} className="text-xs text-primary underline font-medium">save</button>
          </div>
        </div>
      )}
    </div>
  );
}
