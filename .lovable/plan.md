# Extreme Simplicity + Scan Price Intelligence

Order matches your prompt. Appendix (A/B/C) folded into the right slots so nothing drops.

## Price Check coverage report (upfront)

Catalog `bottles` has near-100% `price_band` coverage on all types (red 99.99%, white 99.99%, sparkling/rosé/dessert 100%). Granularity is 5-band ordinal (`$`–`$$$$$`) plus `unknown` (~5% of reds, ~6% of whites). Expected chip coverage per scan ≈ **catalog-match rate × 94–100%**; the honest bottleneck is bottle matching, not band coverage. Chip is suppressed silently when `price_band='unknown'`, when the wine is an unmatched community bottle, or when menu-price OCR failed.

## Part A — Boot fix (blocking, do first)

- Root cause already found: the "Missing SUPABASE_URL/PUBLISHABLE_KEY" throw comes from server-side `requireSupabaseAuth`/publishable helpers reading unprefixed `process.env.*`. `start.ts` middleware fallback is already in — verify by hitting a protected serverFn from a fresh session on published site; if still failing, add same fallback inside `client.server.ts` guard and re-publish.

## Part 1 — First-run onboarding

- New `src/routes/welcome.tsx`: 3-screen skippable intro (swipe/next), copy per spec, illustrated with existing `PalateStar` + a mocked ranked-list screenshot.
- `AuthGate` unchanged for auth; after sign-up, a new `profiles.onboarding_stage` (`intro | rate5 | done`) drives the router: stage=`intro` → `/welcome`; stage=`rate5` → `/rate?mode=onboarding`; stage=`done` → home.
- `rate.tsx` gains `?mode=onboarding`: hides notes, filters, benchmarks, cellar-memory; shows progress bar `n/5`; on 5th rating routes to `/welcome/reveal`.
- `/welcome/reveal`: full-screen `PalateStar` with letter-flip animation, one plain-language line ("You lean silky, fresh and red-fruited…" via `styleNameFor`), two CTAs → `/scan` and `/matches`. Sets `onboarding_stage='done'`.
- Returning users bypass welcome entirely (stage=done at signup migration time).

## Part 2 — Home + scanning

- `src/routes/index.tsx` collapsed to: palate-code cards (tap → existing depth), one primary Scan CTA (big tile), one secondary Matches. Move cube/lanes/brief teasers behind the palate-code tap (already the detail path).
- Copy audit pass across `AppShell`, home, scan, matches: replace "Canon/Nemesis/evidence/ω/calibrated/fingerprint" at first level with "benchmark wine / dealbreaker / palate / signature". Detail views keep the technical terms with a one-line gloss.
- `/scan` becomes a direct camera entry (single pre-prompt line); multi-page strip + Analyze already exists in `scan.list.tsx` — audit for a single Analyze button + server-side persistence (already scan_logs-backed).
- **Results restructure** (`scan.list.tsx`):
  - Pinned "From your cellar memory" (existing `CellarMemorySection`).
  - "Order this" — top 3 by score with match chip, menu price, Price Check chip.
  - "Also good" — remaining matches, compact.
  - "Skip" — vetoed + poor matches, collapsed accordion, one-line reason from existing veto reasons.
  - Unreadable/unmatched — collapsed at bottom with tap-to-fix.
- All rows link `wine/$id`.

## Part 3 — Price Check verdict

- Pure module `src/lib/price-check.ts`: input `{ price_band, menu_price, currency, restaurant_stats? }` → `{ verdict: 'good'|'typical'|'steep'|null, reason }`. Constants: band midpoints (e.g. `$`=$18, `$$`=$40, `$$$`=$80, `$$$$`=$160, `$$$$$`=$300), markup band 2.0–3.2×, steep = >1.25× range top. Returns `null` on `unknown`/missing price/unmatched.
- Chip component `PriceCheckChip.tsx` — amber "Steep", neutral "Typical", positive "Good price". Tone-only, no dollar retail exposed.
- Tap-to-correct: inline editable menu price on each result row (existing OCR is per-wine already); commit calls new serverFn `updateScanWinePrice` which (a) updates `scan_logs.wines[i].price`, (b) writes a `user_corrected` `price_observations` row, (c) recomputes chip via query invalidation.
- "Best value" sort added to `ListControls`: sort key = `predictedStars + verdictBoost` (good=+0.4, steep=−0.4).
- Restaurant-aware refinement: when `restaurant_stats.observation_count >= 8`, blend median markup index into the range; add detail-view context copy.

## Part 4 — Backend: price_observations

Migration (single call):

```sql
create table public.price_observations (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  bottle_id uuid references public.bottles(id) on delete set null,
  cuvee_key text,                    -- lower(producer||' '||name) fallback aggregation
  raw_line text,
  menu_price numeric(10,2) not null,
  currency text not null default 'USD',
  observed_at timestamptz not null default now(),
  scan_id uuid references public.scan_logs(id) on delete set null,
  user_id uuid not null default auth.uid(),
  source text not null check (source in ('ocr','user_corrected')),
  superseded boolean not null default false
);
grant select, insert, update on public.price_observations to authenticated;
grant all on public.price_observations to service_role;
alter table public.price_observations enable row level security;
create policy "owner rw" on public.price_observations for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index on public.price_observations (restaurant_id, cuvee_key, observed_at desc) where superseded = false;
```

Plus SECURITY DEFINER RPCs (no user-id params, uses `auth.uid()` only where writes need it; reads return aggregate-only):
- `restaurant_price_stats(restaurant_id uuid) → { count, median_markup_index, last_observed_at }`
- `restaurant_cuvee_history(restaurant_id uuid, cuvee_key text) → rows of {menu_price, observed_at}` (aggregate-only, no user_id column).

Write path:
- On `attributeScanFn` (already writes to restaurants/restaurant_wines), also insert one `ocr` row per wine that has a numeric `menu_price_amount`.
- Dedupe: within 30d, same `(restaurant_id, cuvee_key)` and same price → update `observed_at`; different price → insert new row and mark previous active row `superseded=true`.
- `user_corrected` insert supersedes the same-scan `ocr` row.

Restaurant page (`restaurants.$id.tsx`): show one-line honest summary from `restaurant_price_stats` when `count ≥ 8`; else silent.

## Appendix fixes

- **B (sommelier brief)**: (1) benchmark loop already clusters — bug is threshold; loosen so any lane with ≥1 canon emits its benchmark (cap 3/type); (2) sweep `hedonicNegatives` for adjective-only outputs and require a noun template; (3) drop the "top-2 nemesis contrasts" cap that hid Nebbiolo — render one contrast per crowned nemesis. Update `sommelier-brief.test.ts` fixtures accordingly.
- **C (cube)**: (1) replace cloud-name source with `styleNameFor` (single vocab); (2) in `TasteCube.tsx` billboarded pole labels compute dot product with camera forward → fade to 15% when negative (far side); nudge caption offsets +0.06 along near-label axis; (3) cloud radius = `max(1.2 * maxAnchorDist, 0.12)` instead of raw `h`; add a rotation-sweep unit assertion in dev tools that nemeses fall outside.

## Technical notes

- New route files use `createFileRoute` under `src/routes/`.
- All new serverFns use `.middleware([requireSupabaseAuth])`.
- No engine/scoring changes; Price Check is a pure presentation module fed by catalog + observations.
- `onboarding_stage` migration also backfills all existing profiles to `'done'` so acceptance-criterion #8 holds.
- Tests: extend `sommelier-brief.test.ts` (B), add `price-check.test.ts`, add a `TasteCube` cloud-radius unit test.

## Deferred (not in this cycle)

- Live retail price APIs, restaurant-facing dashboards, paywall changes — per your out-of-scope list.
- The 3-minute new-user timing acceptance will be reported after Part 1 lands (I'll walk a fresh account with the recorder and paste the split).
