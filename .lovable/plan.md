# Phase 3 + Catalog Hygiene — build plan

Master spec: "Final Build Prompt — Phase 3 (Mutability & Trust) + Catalog Hygiene".
Two workstreams, each split into independently shippable chunks with their
own migration approval, tests, and rollback story. Execute one chunk per turn.

## Sequencing rationale

- **A1 first**: barrel-sample cleanup is the durable version of a hotfix
  already partially shipped (ILIKE filter on canon promotion). Every later
  chunk assumes `excluded_from_recs` is authoritative — B5 references it,
  B1's `set_benchmark` needs to reject excluded rows. Landing A1 first
  removes a foot-gun from all subsequent work.
- **A3 next**: rose/rosé merge is a 2-statement migration + one type-scope
  audit. Cheap, low-risk, unblocks correct type-partitioning in B1/B2.
- **B1 then B2 together**: `set_benchmark` RPC (B1) and `palate_version` bump
  (B2) MUST ship in the same migration — the RPC is the only place the
  version bump belongs. Splitting them creates a race window where direct
  writes can bypass version bumps. B3/B4 depend on this pair.
- **B3, B4, B5 in parallel** after B1+B2: all three consume `set_benchmark`
  and are UI-only on top of it. Can be one turn or three.
- **B6 (dispute signal)** is orthogonal — new columns, new writes, new admin
  view. Ship independently. `fp_dispute_count` column + trigger from rating
  create/edit is the minimum useful shape.
- **A2 (σ audit + California-Chardonnay sweep)** is a batch job, not app
  code. Runs in one turn as a script + insert; produces a report + updates.
  Independent of B1–B6. Best to run BEFORE B6 so the audit-produced list
  seeds the disputed-fingerprints admin view with real cases.
- **B7 acceptance tests**: written incrementally as each chunk lands, run as
  a final gate. Not a separate turn.

## Ordered chunks (each chunk = one turn, one migration if needed)

1. **A1 — Barrel-sample full spec**
   - Migration: `bottles.excluded_from_recs` (already exists — verify),
     backfill via case-insensitive pattern match on 6 tokens, extend
     `canon_wines_validate_tier()` trigger (already blocks excluded — verify
     covers all tokens), report by type.
   - App: audit all three recommendation pools (Matches, Pour-next, scan
     candidates + Uncalibrated) actually filter `excluded_from_recs=false`
     — remove any ILIKE-only hotfix code; scan text-match fallback to
     parent cuvée (same producer, name minus sample token, vintage match).
   - Merge-offer UI on `/canons` and `/rate` for rated excluded rows with
     parent cuvée; accept moves rating + benchmark history atomically.
   - Sweep report printed at end: rows flagged, ratings affected, merges
     offered, benchmarks demoted (expect 0).

2. **A3 — Type normalization**
   - Migration: `UPDATE bottles SET type='rose' WHERE type='rosé';`
   - Audit: every `where('type', ...)` and every palate-type switch — must
     read `'rose'` never `'rosé'`.

3. **A2 — σ flatness audit + California-Chardonnay sweep**
   - Script: compute σ(fp_oak), σ(fp_ripe) per (grape,region) cell ≥5 wines,
     print top-25 lowest-σ ranked by cell size.
   - Re-fingerprint California Chardonnay (confirmed bimodal) with corrected
     prompt; print before/after school split.
   - Log Bourgogne Blanc / Sauvignon Blanc / Chenin σ into memory as
     next-priority audits (do NOT sweep yet — user gates each cell).

4. **B1 + B2 — set_benchmark RPC + palate_version cascade** (single migration)
   - `profiles.palate_version int not null default 0`.
   - `set_benchmark(user_id, bottle_id, tier, action)` RPC with
     `SECURITY DEFINER`, transactional replace, bumps `palate_version`,
     rejects excluded rows, mirrors existing tier-star checks.
   - Trigger on `ratings` insert/update/delete → bump `palate_version`.
   - Response stamping: every recommend/pour/scan/lane server fn returns
     `{ palate_version, ...data }`.
   - Client query keys include `palate_version`; a fetch of the profile
     invalidates the cache automatically when the number changes.
   - ω/h caches recompute inside the mutation path (synchronous, ≤50 anchors).

5. **B3 — Swap / remove / undo UI**
   - Always-visible Swap + Remove buttons on Canon Cellar cards.
   - Swap picker (5★ for Canon, 1–2★ for Nemesis), region filter, calls
     `set_benchmark`.
   - 10-second undo snackbar; undo re-invokes `set_benchmark` with prior
     state, bumps `palate_version` again.

6. **B4 — Rating-edit cascade**
   - Editing a Canon <5★ triggers confirm dialog → demote + save atomically
     via `set_benchmark` (action='demote-on-rating').
   - Same for Nemesis >2★.
   - Deleting a rated wine cascade-demotes any benchmark referencing it.

7. **B5 — Crown-time generic-fingerprint warning**
   - At `usePromoteBenchmark` submit, compute ω-distance from wine's fp to
     type centroid; if `< h_type`, show non-blocking "Crown anyway?" dialog
     with copy from spec.
   - Excluded rows already hard-blocked (A1).

8. **B6 — Dispute signal v1**
   - Migration: `bottles.fp_dispute_count int default 0`,
     `fp_disputes` table (bottle_id, user_id, stars, predicted, delta, at).
   - Trigger / server fn on rating insert/update: if
     `|stars − predicted| ≥ 2.5` and bottle is calibrated, increment count
     and insert dispute row.
   - Admin route `/admin/disputes` (behind `has_role('admin')`) — sorted by
     `count × Σ anchor_weight(disputer)`.
   - NO auto-refingerprint. Human-triggered pass reuses today's
     `user_dispute_signal` mechanism.

## Acceptance test matrix (B7)

Written per chunk, run as a final gate before closing the spec:
- Swap atomicity (B1)
- Cascade < 2s, palate_version stamped (B2)
- Stale-read recompute on scan reopen (B2)
- Rating-edit demote + delete cascade (B4)
- Undo restores atomically (B3)
- Centroid warning fires on centroid wine, skips off-centroid (B5)
- Dispute increment fires at Δ≥2.5, skips Δ<2.5 (B6)
- Barrel-sample scan resolves to parent; promotion rejected; merge offered (A1)
- Lanes rebuild with new Canon header after swap (B3 + existing lanes code)

## Out of scope (locked)

- Server-side `group_predict` migration (deferred until friends ships)
- Tracker-import path
- Auto-suggest Nemesis candidates, mode clustering, per-region sub-models
