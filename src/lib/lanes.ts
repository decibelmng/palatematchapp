// Presentation-layer clustering of ranked candidates into "style lanes,"
// one per Canon anchor cluster. Zero engine changes — this only regroups
// existing recommender output.

import {
  buildTypeContext,
  distanceInContext,
  type FpKey,
  type RatedFp,
  type TypeCtx,
  type WineType,
} from "@/lib/recommender";
import { styleNameFor } from "@/lib/lane-style";

export type LaneItem<T> = {
  predicted: number;
  maxSimilarity: number;
  /** id of the nearest rated cuvée / anchor from the recommender pass. */
  nearestId: string | null;
  vetoed: boolean;
  raw?: boolean;
  payload: T;
};

export type Lane<T> = {
  clusterId: string;
  canonId: string;                 // rep Canon id
  canonName: string;
  canonRegion: string | null;
  canonFp: Record<FpKey, number>;
  canonStars: number;
  memberCanons: RatedFp[];         // includes merged Canons (label wins)
  styleName: string;
  members: LaneItem<T>[];          // sorted (predicted desc, maxSim tiebreak)
  isStub: boolean;                 // true when no member with predicted >= threshold
};

export type BuildLanesResult<T> = {
  hasCanons: boolean;
  lanes: Lane<T>[];
  /** Items whose nearest anchor didn't resolve into any cluster (edge case). */
  unassigned: LaneItem<T>[];
};

const STRONG_THRESHOLD = 4.0;

// ────────── Union-find ──────────
function makeUF(n: number) {
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const union = (a: number, b: number) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  return { find, union };
}

/** Pick the Canon that labels a merged cluster: highest weight → highest
 *  stars → stable id order. */
function labelCanon(canons: RatedFp[]): RatedFp {
  return [...canons].sort((a, b) => {
    const wa = a.weight ?? 1, wb = b.weight ?? 1;
    if (wa !== wb) return wb - wa;
    if (a.stars !== b.stars) return b.stars - a.stars;
    return a.id < b.id ? -1 : 1;
  })[0];
}

export function buildLanes<T>(
  items: LaneItem<T>[],
  ratedFp: RatedFp[],
  type: WineType,
  opts: { strongThreshold?: number } = {},
): BuildLanesResult<T> {
  const strong = opts.strongThreshold ?? STRONG_THRESHOLD;
  const sameType = ratedFp.filter((r) => r.type === type);
  const canons = sameType.filter((r) => r.canon);
  if (canons.length === 0) return { hasCanons: false, lanes: [], unassigned: [] };

  const ctx: TypeCtx | null = buildTypeContext(sameType, type);
  if (!ctx) return { hasCanons: false, lanes: [], unassigned: [] };

  // 1. Cluster Canons: merge when ω-distance < h.
  const uf = makeUF(canons.length);
  for (let i = 0; i < canons.length; i++) {
    for (let j = i + 1; j < canons.length; j++) {
      const d = distanceInContext(canons[i].fp, canons[j].fp, ctx);
      if (d < ctx.h) uf.union(i, j);
    }
  }
  // Group Canons by root.
  const rootToCanons = new Map<number, RatedFp[]>();
  for (let i = 0; i < canons.length; i++) {
    const r = uf.find(i);
    const arr = rootToCanons.get(r) ?? [];
    arr.push(canons[i]);
    rootToCanons.set(r, arr);
  }

  // 2. Build lane skeletons keyed by clusterId = label canon's id.
  const clusters = new Map<string, Lane<T>>();
  for (const group of rootToCanons.values()) {
    const label = labelCanon(group);
    const clusterId = label.id;
    clusters.set(clusterId, {
      clusterId,
      canonId: label.id,
      canonName: label.name,
      canonRegion: label.region ?? null,
      canonFp: label.fp,
      canonStars: label.stars,
      memberCanons: group,
      styleName: styleNameFor(label.fp, type),
      members: [],
      isStub: true,
    });
  }

  // 3. Map every rated cuvée of this type to its nearest Canon cluster.
  const ratedIdToCluster = new Map<string, string>();
  for (const r of sameType) {
    let bestId: string | null = null;
    let bestD = Infinity;
    for (const lane of clusters.values()) {
      // Distance to the closest Canon in the (possibly merged) cluster.
      for (const c of lane.memberCanons) {
        const d = c.id === r.id ? 0 : distanceInContext(r.fp, c.fp, ctx);
        if (d < bestD) { bestD = d; bestId = lane.clusterId; }
      }
    }
    if (bestId) ratedIdToCluster.set(r.id, bestId);
  }

  // 4. Assign each item to a lane via its nearest anchor.
  const unassigned: LaneItem<T>[] = [];
  for (const item of items) {
    if (item.vetoed || item.raw) continue;
    const nearId = item.nearest?.id;
    if (!nearId) { unassigned.push(item); continue; }
    const clusterId = ratedIdToCluster.get(nearId);
    if (!clusterId) { unassigned.push(item); continue; }
    clusters.get(clusterId)!.members.push(item);
  }

  // 5. Sort members per lane (predicted DESC, maxSim tiebreak) and set stub flag.
  const lanes: Lane<T>[] = [];
  for (const lane of clusters.values()) {
    lane.members.sort((a, b) => {
      if (b.predicted !== a.predicted) return b.predicted - a.predicted;
      return (b.maxSimilarity ?? 0) - (a.maxSimilarity ?? 0);
    });
    lane.isStub = !(lane.members[0] && lane.members[0].predicted >= strong);
    lanes.push(lane);
  }

  // 6. Order lanes: populated first (by best predicted DESC), stubs at the
  // bottom (alphabetical by canon name for stability).
  lanes.sort((a, b) => {
    if (a.isStub !== b.isStub) return a.isStub ? 1 : -1;
    if (!a.isStub && !b.isStub) {
      const ap = a.members[0]?.predicted ?? 0;
      const bp = b.members[0]?.predicted ?? 0;
      if (bp !== ap) return bp - ap;
    }
    return a.canonName < b.canonName ? -1 : 1;
  });

  return { hasCanons: true, lanes, unassigned };
}

/** Enforce a global visible-row cap across populated lanes without deleting
 *  any lane. Drops from the tail of the weakest-ranked lane first. */
export function applyGlobalCap<T>(lanes: Lane<T>[], perLaneCap: number, globalCap: number): Lane<T>[] {
  const trimmed = lanes.map((l) => ({
    ...l,
    members: l.isStub ? [] : l.members.slice(0, perLaneCap),
  }));
  // Weakest first = last non-stub lane in the ordering.
  const idxsWeakFirst = trimmed
    .map((l, i) => ({ l, i }))
    .filter((x) => !x.l.isStub)
    .reverse()
    .map((x) => x.i);
  let total = trimmed.reduce((s, l) => s + l.members.length, 0);
  for (const i of idxsWeakFirst) {
    if (total <= globalCap) break;
    const lane = trimmed[i];
    while (lane.members.length > 1 && total > globalCap) {
      lane.members.pop();
      total--;
    }
  }
  return trimmed;
}
