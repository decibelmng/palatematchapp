/**
 * Table-mode classification + reasoning. Pure functions — no data access, no
 * server calls. Extracted so the copy layer is unit-testable and the
 * sommelier surface can reuse it across candidates without a round-trip.
 *
 * Verdict thresholds are ordinal, not scores. The predicted number stays
 * server-side; the surface renders only "loves / fine / not-for-them".
 */

export type Verdict = "loves" | "fine" | "not-for-them";

export const LOVES_MIN = 4.25;
export const FINE_MIN = 3.5;

export function classify(predicted: number): Verdict {
  if (predicted >= LOVES_MIN) return "loves";
  if (predicted >= FINE_MIN) return "fine";
  return "not-for-them";
}

export type GuestPick = {
  userId: string;
  archetype: string;
  initial: string;
  verdict: Verdict;
};

export type CandidateResult = {
  candidateId: string;
  guests: GuestPick[];
  /** Minimum ordinal across guests, used for ranking. */
  worstVerdict: Verdict;
  lovesCount: number;
  finePlus: boolean;
};

export function summarize(
  candidateId: string,
  guests: Array<{ userId: string; archetype: string; initial: string; predicted: number }>,
): CandidateResult {
  const picks: GuestPick[] = guests.map((g) => ({
    userId: g.userId,
    archetype: g.archetype,
    initial: g.initial,
    verdict: classify(g.predicted),
  }));
  const lovesCount = picks.filter((p) => p.verdict === "loves").length;
  const finePlus = picks.every((p) => p.verdict !== "not-for-them");
  const rank = (v: Verdict) => (v === "loves" ? 2 : v === "fine" ? 1 : 0);
  const worst = picks.reduce<Verdict>(
    (acc, p) => (rank(p.verdict) < rank(acc) ? p.verdict : acc),
    "loves",
  );
  return { candidateId, guests: picks, worstVerdict: worst, lovesCount, finePlus };
}

/** Deterministic reasoning sentence. No engine vocabulary. Ordinal only. */
export function reasoningSentence(r: CandidateResult): string {
  const n = r.guests.length;
  const loves = r.lovesCount;
  const misses = r.guests.filter((g) => g.verdict === "not-for-them").length;

  if (r.finePlus && loves >= 2) {
    return "Two guests love it, nobody dislikes it — the safest bottle on the list.";
  }
  if (r.finePlus && loves === 1) {
    return "One guest loves it, nobody at this table rates it below a good match.";
  }
  if (r.finePlus && loves === 0) {
    return "Everyone lands in the same middle — no one's disappointed.";
  }
  // At least one miss. This candidate would only ship as part of a split.
  if (misses === 1 && n > 2) {
    return `One guest at the table wouldn't enjoy this one.`;
  }
  return "This bottle doesn't work for the whole table.";
}

export type WinnerPick = {
  kind: "one-bottle" | "split";
  winner: CandidateResult | null;
  splitPair: [CandidateResult, CandidateResult] | null;
  splitAssignment: Record<string, "a" | "b"> | null;
  reasoning: string;
};

/** Pick a single winner if one exists (all fine+), otherwise compute a
 *  two-bottle cover that maximizes the minimum verdict across guests. */
export function pickTableCall(candidates: CandidateResult[]): WinnerPick {
  if (candidates.length === 0) {
    return { kind: "one-bottle", winner: null, splitPair: null, splitAssignment: null,
      reasoning: "" };
  }

  const rank = (v: Verdict) => (v === "loves" ? 2 : v === "fine" ? 1 : 0);
  const sorted = [...candidates].sort((a, b) => {
    // maximin first, then loves count.
    if (rank(a.worstVerdict) !== rank(b.worstVerdict)) return rank(b.worstVerdict) - rank(a.worstVerdict);
    return b.lovesCount - a.lovesCount;
  });
  const best = sorted[0];

  if (best.finePlus) {
    return {
      kind: "one-bottle",
      winner: best,
      splitPair: null,
      splitAssignment: null,
      reasoning: reasoningSentence(best),
    };
  }

  // Nothing converges. Try a two-bottle cover: for each pair (A,B) route each
  // guest to whichever bottle serves them better, then evaluate the minimum
  // verdict of that assignment. Pick the pair with the best worst-case.
  const guestIds = best.guests.map((g) => g.userId);
  const byId: Record<string, Record<string, Verdict>> = {};
  for (const c of candidates) {
    byId[c.candidateId] = {};
    for (const g of c.guests) byId[c.candidateId][g.userId] = g.verdict;
  }
  let bestPair: { a: CandidateResult; b: CandidateResult; worst: Verdict } | null = null;
  const worstOf = (a: CandidateResult, b: CandidateResult): Verdict => {
    let worst: Verdict = "loves";
    for (const uid of guestIds) {
      const va = byId[a.candidateId][uid] ?? "not-for-them";
      const vb = byId[b.candidateId][uid] ?? "not-for-them";
      const pick = rank(va) >= rank(vb) ? va : vb;
      if (rank(pick) < rank(worst)) worst = pick;
    }
    return worst;
  };
  const pool = sorted.slice(0, Math.min(sorted.length, 12));
  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      const w = worstOf(pool[i], pool[j]);
      if (!bestPair || rank(w) > rank(bestPair.worst)) {
        bestPair = { a: pool[i], b: pool[j], worst: w };
      }
    }
  }

  if (bestPair && rank(bestPair.worst) >= rank("fine")) {
    const assignment: Record<string, "a" | "b"> = {};
    for (const uid of guestIds) {
      const va = byId[bestPair.a.candidateId][uid] ?? "not-for-them";
      const vb = byId[bestPair.b.candidateId][uid] ?? "not-for-them";
      assignment[uid] = rank(va) >= rank(vb) ? "a" : "b";
    }
    return {
      kind: "split",
      winner: null,
      splitPair: [bestPair.a, bestPair.b],
      splitAssignment: assignment,
      reasoning:
        "This table doesn't converge — two bottles serve it better than one.",
    };
  }

  // Truly nothing works. Return the best single option with an honest label.
  return {
    kind: "one-bottle",
    winner: best,
    splitPair: null,
    splitAssignment: null,
    reasoning: reasoningSentence(best),
  };
}

/** Forbidden vocabulary check — used both by tests and by a runtime assert
 *  in dev to catch a copy regression before it ships. */
export const FORBIDDEN_VOCAB = [
  "nemesis", "canon", "veto", "vetoed", "fingerprint",
  "predicted", "palate code", "maximin", "kernel", "axis",
] as const;

export function containsForbidden(s: string): string | null {
  const hay = s.toLowerCase();
  for (const w of FORBIDDEN_VOCAB) {
    if (hay.includes(w)) return w;
  }
  return null;
}
