# Persistent Scans + Restaurant Data Capture

Three shippable parts + schema seams. The load-bearing invariant: **facts stored once, opinion (ranking) always recomputed against the viewer's current palate**.

## Part 1 — Persistent, re-scorable scan history

**Schema (migration):**
- `scans`: add `restaurant_id uuid`, `venue_raw_text text`, `scanned_at timestamptz` (default `created_at`), `share_token text unique` (nullable, for shareable link).
- `scan_wines`: add `raw_text text` (raw OCR line), `format text` (`bottle` | `glass` | `half`, default `bottle`), `price_amount numeric`, `currency text default 'USD'`. Keep existing `raw_json`, `price`.
- `profiles`: add `palate_shareable boolean not null default false` (seam for C, no UI).
- New index on `scan_wines(scan_id)` and `scans(user_id, scanned_at desc)`.

**Server functions (`src/lib/scans-history.functions.ts`):**
- `listUserScans` — user's past scans (id, restaurant, date, wine count, matched count).
- `loadScanForRanking(scan_id)` — returns wines (matched bottle_id + raw fallback) so the client can recompute ranking against the *current* palate. No stored ranking.
- `shareScan(scan_id)` — mints/returns `share_token`.
- `loadSharedScan(token)` — public read; recipient's palate is used client-side.

**UI:**
- New route `src/routes/scans.tsx` (list) and `src/routes/scan.$id.tsx` (detail — reuses ranked list + hero components from `scan.list.tsx`).
- New route `src/routes/s.$token.tsx` — public shared-scan viewer (uses viewer's palate; falls back to signed-out empty state with sign-in nudge).
- Entry: add "Scans" link in account menu / Palate tab (no new bottom-nav tab — 3-tab rule holds).

**Format capture:** parse `glass`/`gl`/`btl` cues from `raw_text` at extraction time; default `bottle`.

## Part 2 — Silent restaurant + price capture

**Restaurant resolver (`src/lib/restaurant-resolver.ts`):**
```ts
interface RestaurantResolver {
  resolve(venue: string, loc?: {lat,lng}): Promise<{restaurant_id, confidence, canonical_name, created: boolean, flag_possible_duplicate: boolean}>;
}
```
- `FuzzyResolver` implementation now: normalize (accents, lowercase, strip noise words `restaurant|the|hotel|café|bar|winery|inn|kitchen`), fuzzy match `restaurants` via existing `search_restaurants` RPC + Levenshtein on normalized. High confidence (≥0.85 token overlap) → link. Low → create new + flag.
- Places swap-in later behind same interface — no capture-code changes.
- Store `venue_raw_text` on scan and (new column) `venue_raw_text_last` on restaurant for later re-canonicalization.

**Capture hook (extends `finalizeScan`):**
On finalize, if a resolver hint exists (venue text captured from a "venue" field the user optionally types — see UI note), silently:
1. Resolve/create restaurant → set `scans.restaurant_id`.
2. For each `scan_wines` row with `matched_bottle_id`: upsert `restaurant_wines`.
3. For each with `price_amount > 0`: **append** `price_observations` row (never overwrite). `observed_at = scans.scanned_at`, `format` copied, `source = 'ocr'`.

**Venue text source:** small optional inline field at scan finalize ("Where was this? *(optional)*"); persists as `venue_raw_text`. No blocking UX — skipping keeps prior "unattributed scan" behavior.

**Restaurants column additions:**
- `restaurants`: `venue_raw_text_last text`, `possible_duplicate boolean not null default false`.

**Price obs discipline:**
- Append-only (existing table already has `superseded` boolean; use it — never delete/update amount).
- Glass vs bottle tagged via `restaurant_wines.format` and denormalized onto `price_observations` via new column `format text default 'bottle'`.

## Part 3 — Admin accumulation dashboard

**Route:** `src/routes/admin.data-capture.tsx` (linked from `admin.usage`).

**Read-only RPCs (security definer, service_role):**
- `admin_capture_summary()` → `{ total_restaurants, total_listings, total_price_obs, restaurants_with_ge_n_obs(n=5), scans_this_week }`.
- `admin_restaurant_coverage()` → per-restaurant `{ id, name, listings, price_obs, first_seen, last_seen, possible_duplicate }`.

**UI:** 5 tiles + sortable per-restaurant table + a "flagged duplicates" filter chip.

## Seams (not shipped)

- `profiles.palate_shareable` boolean exists; no UI.
- `restaurants.possible_duplicate` powers future merge tool.
- Raw text everywhere (`venue_raw_text`, `raw_text` on scan_wines) enables re-resolution when Places swaps in.

## Technical order

1. Migration (schema + seams + indexes + grants).
2. `restaurant-resolver.ts` fuzzy impl.
3. Extend `scan.functions.ts` (createScanRecord accepts venue_raw_text; scanWineBatch persists `raw_text`/`format`/`price_amount`; finalizeScan does silent capture).
4. `scans-history.functions.ts` + Scans list/detail routes + shared route.
5. Admin dashboard route + RPCs.
6. Verify: scan a list, reload → past scan visible; reopening recomputes ranking; price_observations rows appended.

## Lines held

- Price never on `bottles`. Timestamped observations only.
- Ranking never stored. Always recomputed client-side against current palate.
- Raw OCR + raw venue always kept for re-resolution.
- No user-facing "value" claims (Phase B); no reservation handoff UI (Phase C).
- Capture is silent; user's reason to scan stays their ranked list.
