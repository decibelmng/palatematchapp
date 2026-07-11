# Mode-Aware Matches — Style Lanes per Anchor Cluster

Presentation-layer grouping over unchanged recommender output. Every calibrated, non-vetoed candidate joins the lane of its nearest anchor's Canon cluster; Canons with no strong match get an honest stub; anchor-less types keep today's flat list.

## Scope

- New per-type lane layout on `/matches` (all types with ≥1 Canon).
- New "Flat list" toggle (persisted per user).
- Reuse the same lane component on scan results when `scanCandidates.length >= 15`.
- Zero engine changes: `recommend()`, veto logic, cuvée aggregation, group scoring untouched.
- Types with 0 Canons render the current flat list.

## Data flow (per type, per render)

```text
recs (60)  ──►  filter !vetoed, !raw
            │
            ▼
      assign lane by nearest anchor  ──►  anchor→Canon cluster map
            │                                    │
            │                              merge Canons where
            │                              ω(Ci,Cj) < h_type
            ▼
       group by clusterId
            │
            ▼
   per-cluster sort (predicted DESC, maxSim tiebreak)
            │
            ▼
       order clusters by best.predicted DESC
            │
            ▼
     take top 3–5 per cluster · global cap 15
            │
            ▼
     collapsed stub for any Canon cluster with
     no candidate ≥ 4.0 that survived
```

## Lane assignment

1. Collect this type's Canon-flagged rated cuvées → `canons[]`.
2. If `canons.length === 0` → render today's flat list (existing `SectionView` path). Done.
3. Build `canonClusters`:
   - Start with each Canon as its own cluster.
   - Merge two clusters when the ω-distance between their reps is `< h_type` (use the bandwidth already computed in the recommender context; expose via a small helper `getTypeContext(rated, type)` re-using the internal `buildCtx`, or recompute here with the same public helpers).
   - Cluster label = highest-weighted Canon (tie → higher stars → first).
4. For every rated cuvée of this type, precompute `nearestCanonCluster` = the cluster whose rep is closest in ω-space.
5. For each recommendation, `lane = nearestCanonCluster(r.nearest)`. If `r.nearest` is itself a Canon, that Canon's cluster wins directly.

## Lane header (React)

- Canon name + region.
- Human style descriptor derived from the Canon's top 2 fp axes vs the type centroid (e.g. `fresh<0.4 && oak>0.7 → "Mature & savory"`). Table lookup keyed by ranked (axis, sign) pairs; falls back to `"Distinctive"`.
- Mini spoke glyph: inline SVG radar, 8 axes, one polygon, ~28×28px.
- Lane count `n`.
- Collapsed stub variant: `"No strong {style} matches in this pool — via your {Canon name}"`.

## Ranking rules inside/outside lanes

- Inside a lane: existing sort (predicted DESC, maxSim tiebreak) via `applyControls`.
- Lane order: `bestCandidate.predicted` DESC; stub lanes (no ≥4.0) sink to bottom.
- Guarantee: every Canon cluster with ≥1 non-vetoed candidate ≥4.0 renders a populated lane, regardless of another lane's fifth pick.
- Cap: 3 rows per lane by default, "+n more" expander up to 8; global visible cap 15 rows across lanes (drop from the weakest-lane tail first, never delete a lane).
- Avoid block + Uncalibrated disclosure stay global under all lanes, unchanged.

## Controls

- `ListControls` (sort, price, catalogOnly) apply *within* each lane before the top-3 slice.
- New `Layout: Lanes | Flat` toggle above the section, persisted in `localStorage` under `matches:layout` (default `Lanes`). Flat mode = today's exact renderer, unchanged.
- Group mode: keep today's flat maximin list (out of scope for lanes).

## Scan results

- `src/routes/scan/*` result view: when `candidates.length >= 15` and the user has Canons of the scanned type(s), render via the new `LaneList` component; else keep flat.

## Files

New:
- `src/lib/lanes.ts` — `buildLanes(recs, ratedFp, type)` returns `{ lanes: Lane[], flatOrder: RankedCuvee[] }`. Pure, unit-testable. Includes cluster merge, stub detection, ordering.
- `src/lib/lane-style.ts` — axis→style-name table + `styleNameFor(canonFp, typeCentroid)`.
- `src/components/LaneList.tsx` — renders lanes with headers, spoke glyph, expander.
- `src/components/FingerprintSpoke.tsx` — 28px radar SVG for a single fp vector.
- `src/hooks/use-layout-pref.ts` — localStorage-backed `"lanes" | "flat"` with SSR-safe read (via `useEffect` per execution-model rule).
- `src/lib/__tests__/lanes.test.ts` — tests: (a) no Canons ⇒ single "flat" pseudo-lane; (b) two Canons within h merge; (c) Canon with no ≥4.0 candidate ⇒ stub; (d) no candidate appears in two lanes; (e) vetoed excluded; (f) flat toggle reproduces current sort exactly.

Edited:
- `src/routes/matches.tsx` — `SectionView` gains lane path; keep flat renderer intact behind the toggle. Extract the current `<ul>` block into `FlatList` for reuse.
- `src/lib/recommender.ts` — export a small `omegaDistance(fpA, fpB, type, ratedFp)` helper (reuse `buildCtx` internals, no logic change) so `lanes.ts` can measure Canon-to-Canon distance and rated-to-Canon nearest.
- `src/routes/scan.$scanId.tsx` (or the current scan-result route) — wrap candidates in `LaneList` above the threshold.

## Technical notes

- Cluster merge uses the same `omega` vector and `h` the recommender used to score, so lane geometry matches scoring geometry.
- Lane assignment reads only `r.nearest` and the precomputed `ratedId → clusterId` map: O(n).
- Stub logic runs after filters/controls so filter changes can promote a stub into a populated lane (or vice-versa) live.
- Style-name table (~12 rules) chosen so every pair of dominant axes has a fallback; unknown → `"Distinctive"`.
- No changes to `usePourCandidates`, `use-canon`, `cuvee`, `group.functions`.

## Non-goals

- No engine changes (no reweighting, no auto-clustering, no distinctiveness penalty).
- No lane view in group mode.
- No cross-type lanes.
- No lane rename / drag / pin UI.
