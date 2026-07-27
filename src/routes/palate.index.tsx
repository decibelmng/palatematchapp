import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { useOnboardingStage } from "@/hooks/use-onboarding";
import { OnboardingIntro } from "@/components/OnboardingIntro";
import { PalateReveal } from "@/components/PalateReveal";
import {
  useBottlesByIds,
  useRatings,
  bottleToValues,
  bottleType,
  usePersistCode,
} from "@/hooks/use-palate-data";
import { useMyCanons } from "@/hooks/use-canon";
import { useMyProfile } from "@/hooks/use-friends";
import { computeCode, axesFor, type RatedBottle, type PaletteType } from "@/lib/palate";
import { useLandmarks } from "@/hooks/use-landmarks";
import { cuveeKey } from "@/lib/cuvee";
import { TasteMap, type LovedPoint } from "@/components/TasteMap";
import { SommBadge } from "@/components/profile/SommBadge";
import { VisibilityControl } from "@/components/profile/VisibilityControl";
import { ShareProfileButton } from "@/components/profile/ShareProfileButton";
import { NameWithHandle } from "@/components/profile/NameWithHandle";
import { AvatarUpload } from "@/components/profile/AvatarUpload";
import { GraduationCap, Settings2 } from "lucide-react";
import { CalibrationMeter } from "@/components/CalibrationMeter";
import { displayNameFor, initialsFor } from "@/lib/user-display";


export const Route = createFileRoute("/palate/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Your profile — Palate Match" },
      { name: "description", content: "Your Palate Match profile: taste identity, taste profiles, stats, and visibility." },
    ],
  }),
  component: () => <AuthGate><PalateHome /></AuthGate>,
});

const MIN_RATINGS = 5;

function PalateHome() {
  const { data: ratings } = useRatings();
  const { data: profile } = useMyProfile();
  const ratedIds = useMemo(() => (ratings ?? []).map((r) => r.bottle_id), [ratings]);
  const { data: bottles } = useBottlesByIds(ratedIds);
  const { data: canons } = useMyCanons();
  const canonBottleIds = useMemo(
    () => new Set((canons ?? []).filter((c) => c.tier === "canon").map((c) => c.bottle_id)),
    [canons],
  );
  const nemesisBottleIds = useMemo(
    () => new Set((canons ?? []).filter((c) => c.tier === "nemesis").map((c) => c.bottle_id)),
    [canons],
  );

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

  const totalRated = ratings?.length ?? 0;
  const canonsCount = (canons ?? []).filter((c) => c.tier === "canon").length;
  const nemesesCount = (canons ?? []).filter((c) => c.tier === "nemesis").length;
  const anyPalateReady = redRated.length >= MIN_RATINGS || whiteRated.length >= MIN_RATINGS;

  const { stage, isLoading: stageLoading, setStage } = useOnboardingStage();

  const [showReveal, setShowReveal] = useState(false);
  useEffect(() => {
    if (stageLoading) return;
    if (stage !== "done" && anyPalateReady) {
      setShowReveal(true);
      setStage("done").catch(() => { /* toast handled elsewhere */ });
    }
  }, [stage, stageLoading, anyPalateReady, setStage]);

  const defaultScope: PaletteType = whiteRated.length > redRated.length ? "white" : "red";
  const [scope, setScope] = useState<PaletteType>(defaultScope);
  useEffect(() => { setScope(defaultScope); }, [defaultScope]);
  const revealCode = scope === "red" ? red.code : white.code;

  // Onboarding: the "intro" stage now points at the style quiz, not at a
  // recall-based first-rating flow. OnboardingIntro is retired.
  if (!stageLoading && (stage === "intro" || stage === "quiz") && totalRated === 0) {
    if (typeof window !== "undefined") window.location.replace("/onboarding");
    return null;
  }
  if (!stageLoading && stage === "rate5" && !anyPalateReady) {
    return (
      <div className="pt-6">
        <Rate5Progress redN={redRated.length} whiteN={whiteRated.length} />
      </div>
    );
  }

  const memberSince = profile?.created_at
    ? new Date(profile.created_at).toLocaleDateString(undefined, { month: "short", year: "numeric" })
    : "";
  const displayName = displayNameFor(profile ?? null);
  const initial = initialsFor(profile ?? null).charAt(0);

  // Inline viz for the active scope.
  const scoped = scope === "red" ? redRated : whiteRated;
  const scopedCode = scope === "red" ? red.code : white.code;
  const { data: landmarks } = useLandmarks(scope);
  const lovedPoints: LovedPoint[] = useMemo(() => {
    if (!bottles || !ratings) return [];
    const byId = new Map(bottles.map((b) => [b.id, b]));
    const seen = new Map<string, LovedPoint>();
    for (const r of ratings) {
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
    if (!bottles || !ratings) return [];
    const byId = new Map(bottles.map((b) => [b.id, b]));
    const lovedKeys = new Set(lovedPoints.map((p) => p.key));
    const seen = new Map<string, LovedPoint>();
    for (const r of ratings) {
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

  const hasScope = scoped.length > 0;

  return (
    <div className="pt-2 pb-8 max-w-md mx-auto">
      {showReveal && (
        <PalateReveal code={revealCode} type={scope} onDismiss={() => setShowReveal(false)} />
      )}

      {/* Identity */}
      <div className="flex items-center gap-3">
        <AvatarUpload currentUrl={profile?.avatar_url ?? null} initial={initial} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {profile?.username ? (
              <NameWithHandle
                displayName={displayName || null}
                username={profile.username}
              />
            ) : (
              <div className="font-serif text-body leading-tight truncate">{displayName || "Palate Match"}</div>
            )}
            <SommBadge status={profile?.somm_status} role={profile?.somm_role} establishment={profile?.establishment} />
          </div>
          {memberSince && (
            <div className="text-meta text-muted-foreground">joined {memberSince}</div>
          )}
        </div>
        {profile?.username && (
          <ShareProfileButton
            username={profile.username}
            displayName={displayName}
            palateCodeRed={profile.palate_code_red}
            palateCodeWhite={profile.palate_code_white}
            variant="primary"
            label="Share"
          />
        )}
      </div>

      {profile?.bio && (
        <p className="mt-3 text-sm text-muted-foreground">{profile.bio}</p>
      )}

      {/* Stats — all tiles land on one consolidated view. */}
      <div className="mt-5 grid grid-cols-4 gap-2 rounded-[14px] border border-border bg-card p-3 text-center">
        <Link to="/wines" search={{ tab: "rated" }} aria-label="See wines you've rated" className="block rounded-md hover:bg-muted/40 py-1">
          <Stat n={totalRated} label="Rated" />
        </Link>
        <Link to="/wines" search={{ tab: "canons" }} aria-label="See your favorites" className="block rounded-md hover:bg-muted/40 py-1">
          <Stat n={canonsCount} label="Favorites" />
        </Link>
        <Link to="/wines" search={{ tab: "nemeses" }} aria-label="See wines you avoid" className="block rounded-md hover:bg-muted/40 py-1">
          <Stat n={nemesesCount} label="Avoid" />
        </Link>

        <Link to="/wines" search={{ tab: "scored" }} aria-label="Open palate detail" className="block rounded-md hover:bg-muted/40 py-1">
          <Stat n={redRated.length + whiteRated.length} label="Scored" />
        </Link>
      </div>



      {/* Palate codes */}
      <div className="mt-5 grid grid-cols-2 gap-3">
        <CodeChip type="red"   code={red.code}   n={redRated.length}   active={scope === "red"}   onClick={() => setScope("red")} />
        <CodeChip type="white" code={white.code} n={whiteRated.length} active={scope === "white"} onClick={() => setScope("white")} />
      </div>

      {/* Inline viz — dominant scope; toggle changes it above */}
      <div className="mt-4 rounded-[14px] border border-border bg-card p-2">
        {hasScope ? (
          <TasteMap
            type={scope}
            landmarks={landmarks ?? []}
            loved={lovedPoints}
            others={otherPoints}
            canonIds={canonBottleIds}
            nemesisIds={nemesisBottleIds}
          />
        ) : (
          <div className="p-6 text-center text-sm text-muted-foreground">
            Rate some {scope} wines to see your map take shape.
          </div>
        )}
        <div className="mt-2 flex items-center justify-between px-2 pb-1">
          <div className="text-meta text-muted-foreground">Palate code: <span className="font-mono text-foreground">{scopedCode}</span></div>
          <Link to="/palate/$type" params={{ type: scope }} className="text-meta uppercase text-muted-foreground hover:text-primary" style={{  }}>
            Detail + 3D →
          </Link>
        </div>
      </div>

      {/* Calibration meter — % pinned per color, derived from rating counts only. */}
      <div className="mt-4">
        <CalibrationMeter />
      </div>


      {/* Visibility */}
      <div className="mt-5">
        <VisibilityControl current={(profile?.visibility as "private" | "followers" | "public") ?? "private"} />
      </div>

      {/* Verify / settings */}
      <div className="mt-4 flex flex-col gap-2">
        {profile?.somm_status !== "verified" && (
          <Link
            to="/palate/verify"
            className="flex items-center justify-between rounded-[14px] border border-border bg-card p-4 hover:border-primary/40"
          >
            <div className="flex items-center gap-3">
              <GraduationCap className="h-5 w-5 text-primary" />
              <div>
                <div className="text-sm">Verify as a SOMM</div>
                <div className="text-meta text-muted-foreground">Get the badge on your profile.</div>
              </div>
            </div>
            <span className="text-primary text-sm">→</span>
          </Link>
        )}
        <Link
          to="/friends"
          className="flex items-center justify-between rounded-[14px] border border-border bg-card p-4 hover:border-primary/40"
        >
          <div className="flex items-center gap-3">
            <Settings2 className="h-5 w-5 text-muted-foreground" />
            <div className="text-sm">Friends &amp; account</div>
          </div>
          <span className="text-muted-foreground text-sm">→</span>
        </Link>
      </div>
    </div>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div>
      <div className="font-serif text-body leading-tight">{n}</div>
      <div className="text-meta uppercase text-muted-foreground" style={{  }}>{label}</div>
    </div>
  );
}

function CodeChip({ type, code, n, active, onClick }: { type: PaletteType; code: string; n: number; active: boolean; onClick: () => void }) {
  const label = type === "red" ? "RED" : "WHITE";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`text-left rounded-[14px] border p-4 transition ${active ? "border-primary bg-primary/5" : "border-border bg-card hover:border-primary/40"}`}
    >
      <div className="flex items-center justify-between">
        <span className="text-meta uppercase text-muted-foreground" style={{  }}>{label}</span>
        <span className="text-meta text-muted-foreground">{n === 0 ? "no ratings" : `${n} rated`}</span>
      </div>
      <div className="mt-3 mb-1 font-serif text-title text-primary leading-none" style={{  }}>
        {code.split("").map((ch, i) => (
          <span key={`${type}-${i}-${ch}`} className={ch === "·" ? "text-muted-foreground/60" : ""}>{ch}</span>
        ))}
      </div>
    </button>
  );
}

function Rate5Progress({ redN, whiteN }: { redN: number; whiteN: number }) {
  const n = Math.max(redN, whiteN);
  const scope = whiteN > redN ? "whites" : "reds";
  const pct = Math.min(100, (n / MIN_RATINGS) * 100);
  return (
    <div className="text-center max-w-md mx-auto">
      <p className="text-meta uppercase text-muted-foreground" style={{  }}>
        Getting started
      </p>
      <h2 className="mt-3 font-serif text-heading leading-snug">
        Rate {MIN_RATINGS} {scope} to place yourself on the map
      </h2>
      <p className="mt-2 text-xs text-muted-foreground">{n} of {MIN_RATINGS} rated</p>
      <div className="mx-auto mt-4 h-1 max-w-xs rounded-full bg-muted overflow-hidden">
        <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
      </div>
      <Link
        to="/rate"
        className="mt-6 inline-block rounded-md bg-primary text-primary-foreground px-5 py-2.5 text-sm font-medium hover:opacity-90"
      >
        {n >= 1 ? "Keep rating" : "Rate your first wine"}
      </Link>
    </div>
  );
}
