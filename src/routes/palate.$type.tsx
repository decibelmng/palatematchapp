import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { TasteMap, type LovedPoint } from "@/components/TasteMap";
import { PalateBars } from "@/components/PalateBars";
import { ShareCardDialog } from "@/components/ShareCardDialog";
import { useMyProfile } from "@/hooks/use-friends";
import {
  useBottlesByIds,
  useRatings,
  bottleToValues,
  bottleType,
} from "@/hooks/use-palate-data";
import { useMyCanons } from "@/hooks/use-canon";
import { CanonBadge } from "@/components/CanonBadge";
import { Crown, ChevronLeft } from "lucide-react";
import { useLandmarks } from "@/hooks/use-landmarks";
import { cuveeKey } from "@/lib/cuvee";
import { computeCode, describeCode, axesFor, type RatedBottle, type PaletteType } from "@/lib/palate";

const TasteCube = lazy(() => import("@/components/TasteCube").then((m) => ({ default: m.TasteCube })));

function detectWebGL(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch { return false; }
}

export const Route = createFileRoute("/palate/$type")({
  ssr: false,
  parseParams: (p) => {
    if (p.type !== "red" && p.type !== "white") throw notFound();
    return { type: p.type as PaletteType };
  },
  head: ({ params }) => ({
    meta: [
      { title: `Your ${params.type} palate — Palate Match` },
      { name: "description", content: `Your ${params.type} palate map, signature axes, and benchmark wines.` },
    ],
  }),
  component: () => <AuthGate><PalateDetail /></AuthGate>,
});

function PalateDetail() {
  const { type: scope } = Route.useParams();
  const { data: ratings } = useRatings();
  const ratedIds = useMemo(() => (ratings ?? []).map((r) => r.bottle_id), [ratings]);
  const { data: bottles } = useBottlesByIds(ratedIds);
  const { data: canons } = useMyCanons();
  const canonBottleIds = useMemo(() => new Set((canons ?? []).filter((c) => c.tier === "canon").map((c) => c.bottle_id)), [canons]);
  const nemesisBottleIds = useMemo(() => new Set((canons ?? []).filter((c) => c.tier === "nemesis").map((c) => c.bottle_id)), [canons]);

  const rated = useMemo(() => {
    const byId = new Map((bottles ?? []).map((b) => [b.id, b]));
    const out: RatedBottle[] = [];
    for (const r of ratings ?? []) {
      const b = byId.get(r.bottle_id);
      if (!b) continue;
      if (bottleType(b) !== scope) continue;
      out.push({ stars: r.stars, values: bottleToValues(b, scope), canon: canonBottleIds.has(b.id) });
    }
    return out;
  }, [bottles, ratings, scope, canonBottleIds]);

  const computed = useMemo(() => computeCode(rated, axesFor(scope)), [rated, scope]);
  const axes = axesFor(scope);

  const lovedPoints: LovedPoint[] = useMemo(() => {
    const byId = new Map((bottles ?? []).map((b) => [b.id, b]));
    const seen = new Map<string, LovedPoint>();
    for (const r of ratings ?? []) {
      const b = byId.get(r.bottle_id);
      if (!b || bottleType(b) !== scope || r.stars < 4) continue;
      const key = cuveeKey(b);
      const existing = seen.get(key);
      if (existing) { if (r.stars > existing.stars) existing.stars = r.stars; continue; }
      seen.set(key, {
        key, bottleId: b.id,
        axBody: b.ax_body, axFruit: b.ax_fruit_char, axTannin: b.ax_tannin,
        axOak: b.fp_oak, axAcidity: b.ax_acidity, axSweet: b.ax_sweet, axRipe: b.fp_ripe,
        stars: r.stars, name: b.name, producer: b.producer, region: b.region,
      });
    }
    return Array.from(seen.values());
  }, [bottles, ratings, scope]);

  const otherPoints: LovedPoint[] = useMemo(() => {
    const byId = new Map((bottles ?? []).map((b) => [b.id, b]));
    const lovedKeys = new Set(lovedPoints.map((p) => p.key));
    const seen = new Map<string, LovedPoint>();
    for (const r of ratings ?? []) {
      const b = byId.get(r.bottle_id);
      if (!b || bottleType(b) !== scope || r.stars >= 4) continue;
      const key = cuveeKey(b);
      if (lovedKeys.has(key)) continue;
      const existing = seen.get(key);
      if (existing) { if (r.stars < existing.stars) existing.stars = r.stars; continue; }
      seen.set(key, {
        key, bottleId: b.id,
        axBody: b.ax_body, axFruit: b.ax_fruit_char, axTannin: b.ax_tannin,
        axOak: b.fp_oak, axAcidity: b.ax_acidity, axSweet: b.ax_sweet, axRipe: b.fp_ripe,
        stars: r.stars, name: b.name, producer: b.producer, region: b.region,
      });
    }
    return Array.from(seen.values());
  }, [bottles, ratings, scope, lovedPoints]);

  const { data: landmarks } = useLandmarks(scope);
  const { data: myProfile } = useMyProfile();
  const [shareOpen, setShareOpen] = useState(false);

  const [hasWebGL, setHasWebGL] = useState(false);
  useEffect(() => { setHasWebGL(detectWebGL()); }, []);
  const [view, setView] = useState<"2d" | "3d">(() => {
    if (typeof window === "undefined") return "2d";
    return (localStorage.getItem("pm-map-view") as "2d" | "3d") || "2d";
  });
  useEffect(() => { try { localStorage.setItem("pm-map-view", view); } catch { /* ignore */ } }, [view]);

  const label = scope === "red" ? "RED" : "WHITE";

  return (
    <div className="pt-2">
      <Link to="/" className="inline-flex items-center gap-1 text-[11px] uppercase text-muted-foreground hover:text-primary" style={{ letterSpacing: "0.18em" }}>
        <ChevronLeft size={12} /> Back
      </Link>

      <div className="mt-3 text-center">
        <p className="text-[10px] uppercase text-muted-foreground" style={{ letterSpacing: "0.22em" }}>{label} palate</p>
        <div className="mt-2 font-serif text-[34px] leading-none text-primary" style={{ letterSpacing: "0.3em" }}>
          {computed.code.split("").map((ch, i) => (
            <span key={`${i}-${ch}`} className={`pm-letter ${ch === "·" ? "text-muted-foreground/60" : ""}`} style={{ ["--pm-delay" as string]: `${i * 50}ms` }}>{ch}</span>
          ))}
        </div>
      </div>

      <div className="mt-3 flex items-center justify-center gap-4">
        <button type="button" onClick={() => setShareOpen(true)} className="text-[11px] uppercase text-muted-foreground hover:text-primary" style={{ letterSpacing: "0.18em" }}>
          Share your palate →
        </button>
      </div>

      <ShareCardDialog open={shareOpen} onClose={() => setShareOpen(false)} type={scope} code={computed.code} displayName={myProfile?.display_name || myProfile?.username || ""} />

      {hasWebGL && (
        <div className="mt-6 flex items-center justify-center gap-1.5">
          {(["2d", "3d"] as const).map((v) => {
            const on = view === v;
            return (
              <button key={v} type="button" onClick={() => setView(v)} aria-pressed={on}
                className={`rounded-full border-[0.5px] px-3 py-0.5 text-[10px] uppercase transition ${on ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:bg-accent"}`}
                style={{ letterSpacing: "0.16em" }}>
                {v === "2d" ? "2D map" : "3D cube"}
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-6">
        {view === "3d" && hasWebGL ? (
          <Suspense fallback={<div className="w-full max-w-[480px] mx-auto aspect-square rounded-[14px] border-[0.5px] border-border bg-card/40" />}>
            <TasteCube type={scope} loved={lovedPoints} others={otherPoints} canonIds={canonBottleIds} nemesisIds={nemesisBottleIds} />
          </Suspense>
        ) : (
          <TasteMap type={scope} landmarks={landmarks ?? []} loved={lovedPoints} others={otherPoints} canonIds={canonBottleIds} nemesisIds={nemesisBottleIds} />
        )}
      </div>

      <p className="mt-10 font-serif italic text-[15px] text-foreground/90 text-center mx-auto" style={{ maxWidth: "34ch", lineHeight: 1.6 }}>
        {describeCode(computed.letters)}
      </p>

      <div className="mt-10">
        <PalateBars axes={axes} letters={computed.letters} />
      </div>

      <CanonAnchors scope={scope} bottles={bottles ?? []} canons={(canons ?? []).filter((c) => c.tier === "canon")} />

      <div className="mt-10 flex flex-wrap gap-2">
        <Link to="/rate" className="rounded-[14px] border-[0.5px] border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-accent shadow-[var(--pm-card-shadow)]">
          Edit your ratings ({ratings?.length ?? 0})
        </Link>
        <Link to="/rate" className="rounded-[14px] border-[0.5px] border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-accent shadow-[var(--pm-card-shadow)]">
          Rate more
        </Link>
        <Link to="/canons" className="rounded-[14px] border-[0.5px] border-amber-500/50 bg-amber-50/60 dark:bg-amber-950/30 text-amber-800 dark:text-amber-200 px-3 py-1.5 text-xs font-medium hover:bg-amber-100/70 shadow-[var(--pm-card-shadow)] inline-flex items-center gap-1">
          <Crown size={12} strokeWidth={2.2} fill="currentColor" /> Benchmark wines
        </Link>
      </div>
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
          Benchmark wines feeding this palate
        </p>
        <Link to="/canons" className="text-[11px] text-primary hover:underline">All →</Link>
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
