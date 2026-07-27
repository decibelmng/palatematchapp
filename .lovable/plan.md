Three features, built in the order the spec asks — each depends on the schema before it.

## 1. Persist bottle scans (infrastructure)

**Schema (one migration)**

Widen the existing `scans` / `scan_wines` tables — no parallel table.

```
scans:
  + kind text not null default 'list' check (kind in ('list','bottle'))
  + front_image_path text
  + back_image_path text

scan_wines:
  + raw_ocr_text text        (raw text from vision, distinct from the parsed cuvee)
  + rated_at timestamptz     (denormalized flag for the "Rate it" prompt; nullable)
  + user_rated_stars int     (nullable; snapshot at rate time)

new table: scan_wine_corrections
  id, scan_wine_id, user_id, field ('producer'|'cuvee'|'vintage'|'wine_type'|'region'|'grape'),
  old_value text, new_value text, created_at
  RLS: owner-only SELECT/INSERT. Append-only (no UPDATE/DELETE triggers).
  GRANT SELECT, INSERT to authenticated; ALL to service_role.

new table: founder_accounts (id uuid PK = profiles.id, added_at)
  Public SELECT. Insert/update by service_role only. Populated by seed
  migration when a founder profile exists.

new table: rating_share_optout (user_id, rating_id PK)
  RLS: owner-only. Used by the per-rating "don't share this one" toggle.
```

**Storage bucket:** `scan-labels` (private). Downscaled to **1600px long edge @ q=0.82** (same as the existing pipeline in `image-downscale.ts`). Path: `<user_id>/<scan_id>/front.jpg` and `back.jpg`.

**Server fns (new `src/lib/bottle-scan.functions.ts`):**
- `persistBottleScan({ frontPath, backPath, rawOcrText, parsed, matchedBottleId })` → returns `{ scanId, scanWineId }`
- `saveBottleScanCorrection({ scanWineId, field, oldValue, newValue })` → append-only log + patch to scan_wines
- `markBottleScanRated({ scanWineId, stars })` → sets rated_at, user_rated_stars

**Rewire `scan.bottle.tsx`:** after downscale, upload front (and back when present) to the private bucket in parallel with the vision call; on identify success call `persistBottleScan`; on every corrected field call `saveBottleScanCorrection` with old/new; when the user rates from the result surface call `markBottleScanRated`.

**Unify history:** `listUserScans` selects `kind` and joins the first `scan_wines` row (label thumbnail + resolved name) for bottle scans. `src/routes/scans.tsx` renders both, with a `kind === 'bottle' && !rated_at && created_at < now()-3h` inline "Rate it" affordance.

**Route:** existing `/scan/$id` gains a bottle-kind branch that reloads the label photo + parsed fields + correction affordance.

## 2. Feed — venue activity first, people second

**2A Venue activity (ship first, no consent):**

New server fn `getVenueActivity({ limit, before })`:
- Groups `scans` (kind=list, status='parsed') by `(restaurant_id, date_trunc('day', scanned_at))`.
- Filters: `restaurant_id IS NOT NULL` and aggregate `scan_wines` count `>= 8` for the day (attribution floor).
- Compares wine set vs the venue's previous parsed scan to emit **updated / N new since last / first-time**.
- Returns venue name + city + wine count + delta + a link key. **Never returns user_id.**
- Each feed row on the client links to `/venue/<id>` (existing scan-detail surface re-ranked against viewer's palate — reuse `scan.$id` in venue-anon mode, no scanner attribution rendered).

**2B Personal activity (public-only):**

Update `getFriendsFeed` → rename/repurpose to `getGlobalActivity` (friends + public):
- `ratings` join `profiles` where `profiles.visibility = 'public'` **OR** requester is friends with the rater. **Never** returns rows from `private`/`followers` users to non-friends.
- Excludes rating IDs present in `rating_share_optout` for that rater.
- Add a **per-rating menu** on `FeedCard`: "Don't share this one" → inserts into `rating_share_optout`.

**Visibility copy:** rewrite the "Public" hint in `VisibilityControl.tsx`:
> "Anyone with the link can see your full profile, and your ratings may appear in the global feed."

**No manufactured activity:** no `INSERT` seeding of fake ratings, no `created_at` backdating, no filler items. `feed.tsx` empty state links to founder + top-overlap suggestions (see §3).

**Vitest** (`src/lib/__tests__/feed-visibility.test.ts`):
- Fixture: 3 raters, visibilities {private, followers, public}, viewer is not friends with any.
- Assert: only the public user's rating appears in `getGlobalActivity` output shape.
- Assert: with viewer added as friend of `followers` rater, that row appears.
- Assert: `rating_share_optout` filters correctly.

## 3. Founder account — opt-in only

**No auto-anything.** Confirm and document:
- `handle_new_user` trigger only inserts a profile row (verified — no `friendships` or `follows` insert exists in codebase; grep returns zero hits for `auto.?friend|auto.?follow`).

**New surfaces:**
- `FounderCard.tsx` — shown once after `/onboarding/reveal`, dismissible. Renders founder palate code, archetype, 2–3 benchmarks. Single "Follow" button → `follow_user(founder_id)`. Skip link.
- Welcome message: `WelcomeSheet.tsx` fires on first launch after onboarding (gated by `profiles.onboarding_stage`), shows a short signed note. No feed insertion, no edge creation.
- `feed.tsx` empty state: renders "Suggested to follow" — founder card first, then top palate-overlap public users (new server fn `getPaletteOverlapSuggestions({limit:5})` — cosine distance on `palate_code_red/white` vectors, filtered to `visibility='public'`).

**Founder seed:** migration creates the `founder_accounts` table but does not insert a row (spec doesn't identify a founder user_id). Ship an admin surface for the owner to designate later; empty founder table means the card + welcome silently skip.

## Acceptance verification

- SQL check: `SELECT kind, count(*) FROM scans GROUP BY kind` shows both kinds after test scans.
- `scan_wine_corrections` has non-empty old_value + new_value for each edit.
- Grep: `rg -n "friendship.*insert|follow.*insert" src/lib/ supabase/migrations/` returns only user-initiated flows.
- Vitest passes for feed-visibility.
- `feed.tsx` never renders scanner attribution on venue rows (visual check + assert in card component that no user field is passed).

## Technical notes

- Migrations are additive; existing `kind='list'` default backfills old rows.
- `scans.image_paths` jsonb already exists for list scans — bottle uses new dedicated `front_image_path`/`back_image_path` columns for clarity.
- `format='bottle'` on `scan_wines` already exists — bottle scan writes exactly one `scan_wines` row per scan (batch_index=0).
- Corrections log is queryable for catalog quality later; not surfaced in UI in this build.
- Reused `image-downscale.ts` (1600px, q=0.82) — matches list-scan pipeline.

## Files touched (estimate)

- Migrations: 1 (schema) + 1 (bucket via storage tool)
- New: `bottle-scan.functions.ts`, `FounderCard.tsx`, `WelcomeSheet.tsx`, `feed-visibility.test.ts`, `getPaletteOverlapSuggestions` (in `feed.functions.ts`)
- Modified: `scan.bottle.tsx`, `scans.tsx`, `scan.$id.tsx`, `feed.tsx`, `FeedCard.tsx`, `VisibilityControl.tsx`, `feed.functions.ts`, `scans-history.functions.ts`, `onboarding.tsx`

Proceed?