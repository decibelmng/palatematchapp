import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState, useEffect } from "react";
import { AuthGate } from "@/components/AuthGate";
import { TasteMap, type LovedPoint } from "@/components/TasteMap";
import { PalateBars } from "@/components/PalateBars";
import { PourMatchRow } from "@/components/PourMatchRow";
import { ShareCardDialog } from "@/components/ShareCardDialog";
import { useMyProfile } from "@/hooks/use-friends";
import {
  useBottlesByIds,
  useRatings,
  bottleToValues,
  bottleToFp,
  bottleType,
  usePersistCode,
} from "@/hooks/use-palate-data";
import { useLandmarks } from "@/hooks/use-landmarks";
import { useTopMatches } from "@/lib/top-matches";
import { cuveeKey } from "@/lib/cuvee";
import { computeCode, describeCode, axesFor, type RatedBottle, type PaletteType } from "@/lib/palate";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Your Palate Code — Palate Match" },
      { name: "description", content: "Two palate codes — one for reds, one for whites — computed live from the bottles you've rated." },
    ],
  }),
  component: () => <AuthGate><Home /></AuthGate>,
});

const MIN_RATINGS = 5;

function Home() {
  const { data: ratings } = useRatings();
  const ratedIds = useMemo(() => (ratings ?? []).map((r) => r.bottle_id), [ratings]);
  const { data: bottles } = useBottlesByIds(ratedIds);

  // Palate letter code inputs (unchanged math)
  const { redRated, whiteRated } = useMemo(() => {
    const byId = new Map((bottles ?? []).map((b) => [b.id, b]));
    const redRated: RatedBottle[] = [];
    const whiteRated: RatedBottle[] = [];
    for (const r of ratings ?? []) {
      const b = byId.get(r.bottle_id);
      if (!b) continue;
      const t = bottleType(b);
      if (t === "red") redRated.push({ stars: r.stars, values: bottleToValues(b, "red") });
      else if (t === "white") whiteRated.push({ stars: r.stars, values: bottleToValues(b, "white") });
    }
    return { redRated, whiteRated };
  }, [bottles, ratings]);

  const red = useMemo(() => computeCode(redRated, axesFor("red")), [redRated]);
  const white = useMemo(() => computeCode(whiteRated, axesFor("white")), [whiteRated]);

  usePersistCode(red.code, white.code, ratings?.length ?? 0);

  const [scope, setScope] = useState<PaletteType>("red");
  useEffect(() => {
    if (whiteRated.length > redRated.length) setScope("white");
    else setScope("red");
  }, [redRated.length, whiteRated.length]);

  const active = scope === "red" ? red : white;
  const activeAxes = axesFor(scope);
  const activeRated = scope === "red" ? redRated : whiteRated;
  const totalRated = ratings?.length ?? 0;
  const onboarding = activeRated.length < MIN_RATINGS;

  // Loved cuvées of the active type, mapped to fingerprint points
  const lovedPoints: LovedPoint[] = useMemo(() => {
    const byId = new Map((bottles ?? []).map((b) => [b.id, b]));
    const rows = (ratings ?? [])
      .map((r) => ({ r, b: byId.get(r.bottle_id) }))
      .filter((x) => x.b && bottleType(x.b!) === scope && x.r.stars >= 4)
      .map(({ r, b }) => ({
        id: b!.id,
        name: b!.name,
        producer: b!.producer,
        region: b!.region,
        type: bottleType(b!),
        vintage: b!.vintage,
        fp: bottleToFp(b!),
        stars: r.stars,
      }));
    return aggregateRated(rows).map((c) => ({ key: c.cuvee, bottleId: c.id, fp: c.fp }));
  }, [bottles, ratings, scope]);

  const { data: landmarks } = useLandmarks(scope);
  const resolvedLandmarks = landmarks ?? [];

  const { data: myProfile } = useMyProfile();
  const [shareOpen, setShareOpen] = useState(false);
  const activeCode = scope === "red" ? red.code : white.code;
  const canShare = activeRated.length >= MIN_RATINGS;

  return (
    <div className="pt-2">
      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Your palates</p>

      {/* Two-code header */}
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <CodeChipRow type="red" code={red.code} n={redRated.length} active={scope === "red"} onClick={() => setScope("red")} />
        <CodeChipRow type="white" code={white.code} n={whiteRated.length} active={scope === "white"} onClick={() => setScope("white")} />
      </div>

      {canShare && (
        <div className="mt-2 text-center">
          <button
            type="button"
            onClick={() => setShareOpen(true)}
            className="text-xs text-muted-foreground hover:text-primary"
          >
            Share your palate →
          </button>
        </div>
      )}

      <ShareCardDialog
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        type={scope}
        code={activeCode}
        displayName={myProfile?.display_name || myProfile?.username || ""}
      />


      {/* Taste map */}
      <div className="mt-6">
        <TasteMap
          type={scope}
          landmarks={resolvedLandmarks}
          loved={onboarding ? [] : lovedPoints}
          showOverlay={onboarding}
          overlayText="Where do you land?"
        />
      </div>

      {onboarding ? (
        <OnboardingBlock scope={scope} n={activeRated.length} />
      ) : (
        <>
          <p className="mt-3 text-xs text-muted-foreground text-center">
            Small dots are wines you love · each ring is one of your taste modes — you can have more than one
          </p>
          <p className="mt-3 text-sm text-foreground/90 leading-relaxed text-center">
            {describeCode(active.letters)}
          </p>

          <div className="mt-6">
            <PalateBars axes={activeAxes} letters={active.letters} />
          </div>

          <div className="mt-6 flex flex-wrap gap-2">
            <Link to="/rate" className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-accent">
              Edit your ratings ({totalRated})
            </Link>
            <Link to="/rate" className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-accent">
              Rate more
            </Link>
            <Link to="/pour" className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium hover:opacity-90">
              Pour next →
            </Link>
          </div>
        </>
      )}

      {totalRated > 0 && <TopMatchesSection />}
    </div>
  );
}

function OnboardingBlock({ scope, n }: { scope: PaletteType; n: number }) {
  const pct = Math.min(100, (n / MIN_RATINGS) * 100);
  return (
    <div className="mt-5 text-center">
      <h2 className="font-serif text-[17px] leading-snug">
        Rate {MIN_RATINGS} {scope === "red" ? "reds" : "whites"} to place yourself on the map
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">{n} of {MIN_RATINGS} rated</p>
      <div className="mx-auto mt-3 h-1 max-w-xs rounded-full bg-muted overflow-hidden">
        <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
      </div>
      <Link
        to="/rate"
        className="mt-5 inline-block rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:opacity-90"
      >
        {n >= 1 ? "Keep rating" : "Rate your first wine"}
      </Link>
      <ol className="mt-6 grid gap-3 text-left max-w-sm mx-auto">
        {[
          "Rate wines you know you love — or don't",
          "You appear on the map with a palate code",
          "Scan any wine list — we rank it for you",
        ].map((text, i) => (
          <li key={i} className={`flex items-center gap-3 text-[13px] ${i === 0 ? "" : "opacity-60"}`}>
            <span className="w-5 h-5 rounded-full border border-border flex items-center justify-center text-[11px]">
              {i + 1}
            </span>
            <span>{text}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function CodeChipRow({
  type, code, n, active, onClick,
}: {
  type: PaletteType;
  code: string;
  n: number;
  active: boolean;
  onClick: () => void;
}) {
  const label = type === "red" ? "RED" : "WHITE";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left rounded-xl border p-3 transition ${
        active ? "border-primary bg-primary/5" : "border-border bg-card/60 hover:bg-accent"
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{label}</span>
        <span className="text-[10px] text-muted-foreground">
          {n === 0 ? "no ratings yet" : n < 3 ? `still learning · ${n}` : `${n} rated`}
        </span>
      </div>
      <div
        className="mt-2 font-serif text-2xl text-primary"
        style={{ letterSpacing: "0.3em" }}
      >
        {code.split("").map((ch, i) => (
          <span key={i} className={ch === "·" ? "text-muted-foreground/60" : ""}>{ch}</span>
        ))}
      </div>
    </button>
  );
}

function TopMatchesSection() {
  const { data: matches, loading } = useTopMatches(5);
  if (loading && matches.length === 0) return null;
  if (matches.length === 0) return null;
  return (
    <section className="mt-10">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-serif text-xl">Top matches for you</h2>
        <Link to="/pour" className="text-xs font-semibold text-primary hover:opacity-80">
          See all matches →
        </Link>
      </div>
      <ul className="mt-2 divide-y divide-border">
        {matches.map((m) => <PourMatchRow key={m.cuvee.cuvee} match={m} />)}
      </ul>
    </section>
  );
}
