import { createFileRoute, Link } from "@tanstack/react-router";
import { lazy, Suspense, useMemo, useState, useEffect } from "react";
import { AuthGate } from "@/components/AuthGate";
import { TasteMap, type LovedPoint } from "@/components/TasteMap";
import { PalateBars } from "@/components/PalateBars";

const TasteCube = lazy(() => import("@/components/TasteCube").then((m) => ({ default: m.TasteCube })));

function detectWebGL(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch { return false; }
}

import { ShareCardDialog } from "@/components/ShareCardDialog";
import { useMyProfile } from "@/hooks/use-friends";
import {
  useBottlesByIds,
  useRatings,
  bottleToValues,
  bottleType,
  usePersistCode,
} from "@/hooks/use-palate-data";
import { useMyCanons } from "@/hooks/use-canon";
import { CanonBadge } from "@/components/CanonBadge";
import { Crown } from "lucide-react";
import { useLandmarks } from "@/hooks/use-landmarks";
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

  const { data: canons } = useMyCanons();
  const canonBottleIds = useMemo(() => new Set((canons ?? []).filter((c) => c.tier === "canon").map((c) => c.bottle_id)), [canons]);
  const nemesisBottleIds = useMemo(() => new Set((canons ?? []).filter((c) => c.tier === "nemesis").map((c) => c.bottle_id)), [canons]);


  // Palate letter code inputs (unchanged math). Canon-anchored bottles pass
  // canon:true so computeCode multiplies their sample weight by CANON_WEIGHT.
  const { redRated, whiteRated } = useMemo(() => {
    const byId = new Map((bottles ?? []).map((b) => [b.id, b]));
    const redRated: RatedBottle[] = [];
    const whiteRated: RatedBottle[] = [];
    for (const r of ratings ?? []) {
      const b = byId.get(r.bottle_id);
      if (!b) continue;
      const t = bottleType(b);
      const canon = canonBottleIds.has(b.id);
      if (t === "red") redRated.push({ stars: r.stars, values: bottleToValues(b, "red"), canon });
      else if (t === "white") whiteRated.push({ stars: r.stars, values: bottleToValues(b, "white"), canon });
    }
    return { redRated, whiteRated };
  }, [bottles, ratings, canonBottleIds]);

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

  // Loved bottles (≥4★) of the active type, deduped by cuvée for the map.
  // Keep the highest star rating seen across the cuvée.
  const lovedPoints: LovedPoint[] = useMemo(() => {
    const byId = new Map((bottles ?? []).map((b) => [b.id, b]));
    const seen = new Map<string, LovedPoint>();
    for (const r of ratings ?? []) {
      const b = byId.get(r.bottle_id);
      if (!b) continue;
      if (bottleType(b) !== scope) continue;
      if (r.stars < 4) continue;
      const key = cuveeKey(b);
      const existing = seen.get(key);
      if (existing) {
        if (r.stars > existing.stars) existing.stars = r.stars;
        continue;
      }
      seen.set(key, {
        key,
        bottleId: b.id,
        axBody: b.ax_body,
        axFruit: b.ax_fruit_char,
        stars: r.stars,
        name: b.name,
        producer: b.producer,
        region: b.region,
      });
    }
    return Array.from(seen.values());
  }, [bottles, ratings, scope]);

  // Non-loved rated cuvées (1–3★) of the active type — for × marks and neutral dots.
  // Dedupe by cuvée keeping the LOWEST star (worst impression drives the mark).
  const otherPoints: LovedPoint[] = useMemo(() => {
    const byId = new Map((bottles ?? []).map((b) => [b.id, b]));
    const lovedKeys = new Set(lovedPoints.map((p) => p.key));
    const seen = new Map<string, LovedPoint>();
    for (const r of ratings ?? []) {
      const b = byId.get(r.bottle_id);
      if (!b) continue;
      if (bottleType(b) !== scope) continue;
      if (r.stars >= 4) continue;
      const key = cuveeKey(b);
      if (lovedKeys.has(key)) continue;
      const existing = seen.get(key);
      if (existing) {
        if (r.stars < existing.stars) existing.stars = r.stars;
        continue;
      }
      seen.set(key, {
        key, bottleId: b.id,
        axBody: b.ax_body, axFruit: b.ax_fruit_char,
        stars: r.stars, name: b.name, producer: b.producer, region: b.region,
      });
    }
    return Array.from(seen.values());
  }, [bottles, ratings, scope, lovedPoints]);

  const { data: landmarks } = useLandmarks(scope);
  const resolvedLandmarks = landmarks ?? [];

  const { data: myProfile } = useMyProfile();
  const [shareOpen, setShareOpen] = useState(false);
  const activeCode = scope === "red" ? red.code : white.code;
  const canShare = activeRated.length >= MIN_RATINGS;

  return (
    <div className="pt-2">
      <p className="text-[10px] uppercase text-muted-foreground" style={{ letterSpacing: "0.22em" }}>Your palates</p>

      {/* Two-code header */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <CodeChipRow type="red" code={red.code} n={redRated.length} active={scope === "red"} onClick={() => setScope("red")} />
        <CodeChipRow type="white" code={white.code} n={whiteRated.length} active={scope === "white"} onClick={() => setScope("white")} />
      </div>

      {canShare && (
        <div className="mt-3 flex items-center justify-center gap-4">
          <button
            type="button"
            onClick={() => setShareOpen(true)}
            className="text-[11px] uppercase text-muted-foreground hover:text-primary"
            style={{ letterSpacing: "0.18em" }}
          >
            Share your palate →
          </button>
          <span aria-hidden="true" className="text-muted-foreground/40">·</span>
          <Link
            to="/matches"
            className="text-[11px] uppercase text-muted-foreground hover:text-primary"
            style={{ letterSpacing: "0.18em" }}
          >
            See your matches →
          </Link>
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
      <div className="mt-10">
        <TasteMap
          type={scope}
          landmarks={resolvedLandmarks}
          loved={onboarding ? [] : lovedPoints}
          others={onboarding ? [] : otherPoints}
          canonIds={canonBottleIds}
          nemesisIds={nemesisBottleIds}
          showOverlay={onboarding}
          overlayText="Where do you land?"
        />
      </div>


      {onboarding ? (
        <OnboardingBlock scope={scope} n={activeRated.length} />
      ) : (
        <>
          <p className="mt-10 font-serif italic text-[15px] text-foreground/90 text-center mx-auto"
             style={{ maxWidth: "34ch", lineHeight: 1.6 }}>
            {describeCode(active.letters)}
          </p>

          <div className="mt-10">
            <PalateBars axes={activeAxes} letters={active.letters} />
          </div>

          <CanonAnchors scope={scope} bottles={bottles ?? []} canons={(canons ?? []).filter((c) => c.tier === "canon")} />

          <div className="mt-10 flex flex-wrap gap-2">
            <Link to="/rate" className="rounded-[14px] border-[0.5px] border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-accent shadow-[var(--pm-card-shadow)]">
              Edit your ratings ({totalRated})
            </Link>
            <Link to="/rate" className="rounded-[14px] border-[0.5px] border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-accent shadow-[var(--pm-card-shadow)]">
              Rate more
            </Link>
            <Link to="/canons" className="rounded-[14px] border-[0.5px] border-amber-500/50 bg-amber-50/60 dark:bg-amber-950/30 text-amber-800 dark:text-amber-200 px-3 py-1.5 text-xs font-medium hover:bg-amber-100/70 shadow-[var(--pm-card-shadow)] inline-flex items-center gap-1">
              <Crown size={12} strokeWidth={2.2} fill="currentColor" /> Canon Cellar
            </Link>
          </div>
        </>
      )}
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
          "Scan any wine list — we show your matches",
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

function CanonAnchors({
  scope, bottles, canons,
}: {
  scope: PaletteType;
  bottles: import("@/hooks/use-palate-data").BottleRow[];
  canons: import("@/hooks/use-canon").CanonRow[];
}) {
  const rows = useMemo(() => {
    const byId = new Map(bottles.map((b) => [b.id, b]));
    const out: { canon: (typeof canons)[number]; bottle: (typeof bottles)[number] }[] = [];
    for (const c of canons) {
      const b = byId.get(c.bottle_id);
      if (!b) continue;
      if (bottleType(b) !== scope) continue;
      out.push({ canon: c, bottle: b });
    }
    return out;
  }, [bottles, canons, scope]);

  if (rows.length === 0) return null;

  return (
    <div className="mt-10">
      <div className="flex items-center justify-between">
        <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground flex items-center gap-1.5">
          <Crown size={12} strokeWidth={2.2} fill="currentColor" className="text-amber-600" />
          Canon anchors feeding this palate
        </p>
        <Link to="/canons" className="text-[11px] text-primary hover:underline">All canons →</Link>
      </div>
      <ul className="mt-3 space-y-1.5">
        {rows.map(({ canon, bottle }) => (
          <li key={canon.id} className="text-xs flex items-center gap-2">
            <CanonBadge />
            <span className="text-foreground/90 truncate">{bottle.name}</span>
            <span className="text-muted-foreground">· {canon.region}</span>
          </li>
        ))}
      </ul>
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
      className={`text-left rounded-[14px] border-[0.5px] p-4 transition shadow-[var(--pm-card-shadow)] ${
        active ? "border-primary bg-[color-mix(in_oklab,var(--color-primary)_3%,var(--color-card))]" : "border-border bg-card/60 hover:bg-accent"
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase text-muted-foreground" style={{ letterSpacing: "0.22em" }}>{label}</span>
        <span className="text-[10px] text-muted-foreground">
          {n === 0 ? "no ratings yet" : n < 3 ? `still learning · ${n}` : `${n} rated`}
        </span>
      </div>
      <div
        className="mt-3 mb-1 font-serif text-[30px] text-primary leading-none"
        style={{ letterSpacing: "0.3em" }}
      >
        {code.split("").map((ch, i) => (
          <span
            key={`${type}-${i}-${ch}`}
            className={`pm-letter ${ch === "·" ? "text-muted-foreground/60" : ""}`}
            style={{ ["--pm-delay" as string]: `${i * 50}ms` }}
            title={ch === "X" ? "loves both poles" : undefined}
          >
            {ch}
          </span>
        ))}
      </div>
    </button>
  );
}
