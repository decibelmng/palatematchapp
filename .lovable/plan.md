## Diagnosis (reporting before fixing, per instruction)

### 1) Where the synthesis lives (mandate: no new math)

The working synthesis is `callFingerprintGateway` in `src/lib/fingerprint-prompt.ts`, called by:
- `src/lib/on-demand-bottle.functions.ts::resolveOrCreateOnDemandCore` (new-bottle path)
- `src/lib/fingerprint-worker.ts::refingerprintCuveeByBottleId` (cuvée re-fingerprint)
- `src/lib/add-bottle.functions.ts::researchBottle` (client preview)

All three apply the same axis mapping: `ax_fruit_char <- fp.savory`, `ax_body <- fp.body`, etc. This is the pipeline that produced `ax_fruit_char = 0.30–0.40` for the calibrated Timorasso rows.

**The current `AddBottleDialog` already routes through `resolveOrCreateOnDemand`** (source = `'on-demand'`). The 6 on-demand whites in the catalog confirm it's healthy — coherent fingerprints, ax_fruit_char correctly tracking fp_savory (0.30, 0.30, 0.35, 0.55, 0.10, 0.50).

### 2) Is `fp_fruit_dark = 0` legitimate for whites? — YES

Distribution across 35,919 catalog whites:

| Source | n | fp_fruit_dark=0 | ax_fruit_char=0 |
|---|---|---|---|
| base-LLM-calibrated | 33,543 | 1,010 (3%) | 468 |
| WineEnthusiast Kaggle | 2,357 | 34 | 0 |
| WineEnthusiast note (legacy) | 9 | 9 (100%) | 9 |
| on-demand (current) | 6 | 6 (100%) | 0 |
| user-added (legacy) | 4 | 4 (100%) | 3 |

- **on-demand whites at fp_fruit_dark=0**: the LLM legitimately returns 0 for dark-fruit on whites (they have none). Their ax_fruit_char is coherent (0.10–0.55). **Not a bug.**
- **base-LLM whites at fp_fruit_dark=0** (3%): also LLM signal — the LLM sometimes reports 0 dark-fruit for a white.
- No user-added / on-demand path is pinning `fp_fruit_dark` via a default.

### 3) Column defaults — user hypothesis is inverted

Actual defaults are **`0.5`**, not `0.0`, on every ax_/fp_ column (NOT NULL). So a defaulted insert would land mid-scale, not at the boundary. The zeros in the four broken rows are **written values**, not defaults.

That said, the write-time-boundary guard the user proposed is still worth adding — it converts silent axis-mapping bugs into loud rejects.

### 4) The four rated wines — root cause identified

| Wine | Source string | Created |
|---|---|---|
| Meursault, Ballot-Millot | `user-added` (legacy) | 2026-07-04 |
| Gaja Rossj-Bass | `user-added` (legacy) | 2026-07-11 |
| La Spinetta Derthona | `user-added` (legacy) | 2026-07-11 |
| Chateau Montelena 2014 | `WineEnthusiast note; LLM re-fingerprinted (…)` | 2026-06-30 |

The three `user-added` rows carry `fp_savory = 0.4` but `ax_fruit_char = 0` — the mapping was **not applied**. They also share suspiciously identical fp vectors, indicating a retired hand-rolled path (source string `"user-added"` is no longer written anywhere in current code; grep confirms).

**Root cause**: legacy insert path (now removed) that hardcoded ax_* values instead of mapping from fp_*. Current `resolveOrCreateOnDemand` writes `source='on-demand'` and applies the correct mapping — verified against the 6 current on-demand whites.

Montelena is a different case: LLM re-fingerprint failure previously flagged as low-confidence.

### 5) The other 477 base-LLM zeros — legitimate, but flat-savory

Spot-checked 5: fp_savory=0 across all, coherent other axes. Since `ax_fruit_char <- fp_savory`, savory=0 correctly maps to fruit_char=0 (highly fruit-forward). The LLM is doing this deliberately for high-fruit-forward whites (Albariño, Blanc de Pinot Noir, Portuguese Dão white, etc.). Not a bug — a boundary hit that a guard would false-positive on.

### 6) Reds — mostly clean

Reds at exact bounds across ax_ columns, by source:

| Source | n | ax_body=1 | ax_fc=0 | ax_tannin=1 | ax_acidity=0/1 |
|---|---|---|---|---|---|
| base-LLM | 66,301 | 14 | 34 | 1 | 0 |
| wine-enthusiast | 5,410 | 0 | 0 | 0 | 0 |
| on-demand | 17 | 0 | 0 | 0 | 0 |
| user-added | 4 | 0 | 0 | 0 | 0 |

Reds via the same legacy `user-added` path do NOT show the bounds pattern. The legacy bug was white-specific (whites' savory-vs-fruit-dark axis mapping).

---

## Fix plan

### Step A — Retire legacy insert path defensively (schema)

Migration:

1. **Add a write-time guard trigger** on `bottles` (BEFORE INSERT/UPDATE): reject any write where a fp_/ax_ value equals exactly `0.0` or `1.0` **unless** either (a) `fp_fruit_dark = 0` on a white (documented legitimate) or (b) `source ILIKE '%LLM-derived calibrated%'` (already-written base catalog). New writes that land on a bound fail loudly with axis name in the error.

2. **Drop the `DEFAULT 0.5` on every ax_/fp_ column.** Combined with NOT NULL, this makes an insert that omits any axis fail with `null value in column …`. Legacy code paths that silently relied on defaults now surface.

### Step B — Backfill via the real pipeline (no invented math)

- Re-fingerprint the three `user-added` whites (Gaja Rossj-Bass, La Spinetta Derthona, Ballot-Millot Meursault) by invoking `refingerprintCuveeByBottleId` via a one-shot server function `adminRefingerprintById(bottle_id)` (uses the same LLM prompt as the base catalog). Cuvée-group re-fingerprint stamps `refingerprinted_at` and writes source suffix `refingerprinted (cuvée-level)`.

- Chateau Montelena 2014: hand-set from the logged tasting-evidence benchmark (fresh, balanced, mineral, restrained oak, bright acidity). This is tasting-derived, not reputation-derived, so it's allowed per the invariant. Values proposed (all whites are `fp_tannin=0, fp_fruit_dark=0` — legitimate): `fp_fresh 0.80, fp_acid 0.85, fp_ripe 0.35, fp_oak 0.25, fp_body 0.55, fp_savory 0.65`, giving `ax_fruit_char 0.65, ax_body 0.55, ax_acidity 0.85`. Source suffix: `; tasting-derived correction (logged benchmark)`. Written through `catalog_corrections` (append-only) so it survives audit.

### Step C — Bump palate_version and report engine impact

- Run `UPDATE profiles SET palate_version = palate_version + 1 WHERE id = <rater>` — invalidates all caches.
- **Before/after report** (I'll generate after the writes): white palate_code diff (currently `·····`); benchmark/dealbreaker assignments diff; top-5 white recommendations diff. All four wines were previously scored as maximally fruit-forward; the corrections move them into mineral/high-acid space.

### Rollback

- The trigger is easy to disable with `ALTER TABLE ... DISABLE TRIGGER`.
- Legacy `user-added` bottles will get `refingerprinted_at` set + original fp_/ax_ overwritten — `bottles_seed_prior` already freezes fp_*_prior on insert so the original priors are preserved for the recompute job.
- Column defaults can be restored with a one-line migration if downstream code turns out to rely on them.

### What I'm explicitly NOT doing

- No new synthesis formula (no `fp_savory − fp_fruit_dark`).
- Not touching `on-demand` whites — verified coherent.
- Not touching the 477 base-LLM ax_fruit_char=0 rows — LLM signal, not defect.
- Not touching reds — no bounds pattern via user-added/on-demand.
- Not changing engine math or the ax_fruit_char <- fp_savory mapping.

Confirm to proceed, or say which steps to defer.
