
# Sommelier Mode — `/somm`

Three surfaces gated on `profile.somm_status === "verified"`. Reuses existing engine primitives (`groupPredict`, `buildFullBrief`, scan persistence) — the work is the surface, the persistence, and the copy.

## Layout & gate

- `src/routes/_authenticated/somm.tsx` — pathless layout: fetches profile, redirects to `/palate/verify` if not verified. Renders a service-theme wrapper (forces `data-theme="service"` locally, does not persist) with a spartan top strip: "SOMM · <establishment>" and back-to-app.
- `src/routes/_authenticated/somm.index.tsx` — landing: two large tiles, "Table mode" and "House list". Nothing else.

## Surface 1 — Table mode  (`/somm/table`)

Single route with three stages driven by local state (no URL steps — a sommelier does not deep-link into a table mid-service).

### Stage A — Guests (1–6)
- `AddGuestSheet`: three tabs — **Scan QR**, **Enter code**, **Paste link**.
- Guests are stored in local component state as `{ userId, archetype, palateCodeRed, palateCodeWhite, visibility }` — no server-side "table" row. Nothing about the table is persisted; when the sommelier leaves the surface it evaporates.
- Chip = archetype name + first-name initial ("Silk & Perfume · M."). Never a raw code. Tap chip → confirmation to remove.
- Server fn `resolveGuestToken(token|code|username)` — validates the guest exists and returns the minimum payload above. Never returns anchors, ratings, or the full palate — even to a verified somm.

### Stage B — List
- Two options: **This service's house list** (loads active version from Surface 2 — see below) or **Scan a fresh list** (reuses the existing scan pipeline; the resulting scan is offered as "save as house list?" at the end).

### Stage C — The table call
- `groupPredict` already returns per-person predictions and a group score. We wrap it with a `callTable` server fn that:
  - Excludes OOS wines (join `house_list_stock`).
  - Runs group scoring per wine.
  - Classifies each guest's prediction into `loves` / `fine` / `not-for-them` using stable thresholds (≥4.25, ≥3.5, <3.5) — no decimals shown.
  - Picks the winner by maximin (min prediction across guests), tiebreak by count of `loves`.
  - Generates a reasoning sentence from the classification tally, deterministically:
    - all ≥ `fine` and ≥2 `loves` → "Two guests love it, nobody dislikes it — the safest bottle on the list."
    - all ≥ `fine`, 1 `loves` → "One guest loves it, nobody at this table rates it below a good match."
    - all ≥ `fine`, 0 `loves` → "Everyone lands in the same middle — no one's disappointed."
    - Never "predicted", "score", "maximin", "kernel" in the string.
- **Per-guest agreement strip**: single row per guest — initial + archetype + one of three glyphs (heart / check / minus, non-color-only via shape). No numbers.
- **Alternates for service**: two tiles chosen by heuristic on the ranked pool:
  - "If they want to spend less" — cheapest wine in top quartile of group score that is at least `fine` for everyone.
  - "If someone wants a white/red" — best-scoring wine of the opposite dominant type of the winner.
  - Fall back to hiding a tile if no candidate qualifies. Never invent one.
- **Split suggestion** — fires when no wine has all guests ≥ `fine`. Compute a two-wine cover: partition guests to minimize max unhappiness, pick the best wine for each partition. Displayed as "This table doesn't converge — two bottles serve it better than one." with the two picks and initials of who each serves.

### Copy audit
- Regex-gate all sommelier-facing strings against the forbidden vocabulary list. Test in `src/lib/__tests__/somm-copy.test.ts`.

## Surface 2 — House list  (`/somm/list`)

Persistent house list scoped to `establishment` (string on `profiles`; treat exact match as the group key — good enough for v1).

### Schema (one migration)

```sql
-- Versioned house lists per establishment
CREATE TABLE public.house_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  establishment text NOT NULL,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  active_version int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (establishment)
);

CREATE TABLE public.house_list_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  house_list_id uuid NOT NULL REFERENCES public.house_lists(id) ON DELETE CASCADE,
  version int NOT NULL,
  scan_id uuid REFERENCES public.scans(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  UNIQUE (house_list_id, version)
);

CREATE TABLE public.house_list_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id uuid NOT NULL REFERENCES public.house_list_versions(id) ON DELETE CASCADE,
  bottle_id uuid REFERENCES public.bottles(id),
  raw_producer text, raw_cuvee text, raw_vintage int,
  price_amount numeric, currency text, format text NOT NULL DEFAULT 'bottle',
  corrected boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.house_list_stock (
  house_list_id uuid NOT NULL REFERENCES public.house_lists(id) ON DELETE CASCADE,
  bottle_id uuid NOT NULL,
  out_of_stock boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES auth.users(id),
  PRIMARY KEY (house_list_id, bottle_id)
);
```

Grants + RLS: all four tables auth-only. Policies: `owner_id = auth.uid()` OR `has_role(auth.uid(), 'admin')`. Also allow any verified somm at the same establishment to read/update — via a `same_establishment_verified_somm(user_id, establishment)` security-definer function that reads `profiles`.

### UI
- Empty state: "Scan your list" hero (same treatment as `/scan/list`).
- Populated state:
  - Version badge: "v3 · updated today · 6 added, 2 gone, 4 price changes" (diffs computed against previous version by bottle_id + raw string match).
  - List rendered virtualized. Each row: name (2-line wrap, no truncation), price, an inline OOS toggle (big 44px tap target, `pm-skip-badge` when off).
  - Long-press or tap the "correct" chip → inline OCR correction sheet. Persists a `catalog_corrections` row (`source_type='somm_correction'`) and updates the item's `bottle_id` / raw fields.
- Re-scan → creates version N+1, computes diff, prompts activate.

### Correction feedback loop
- A verified-somm correction is high-signal ground truth. Pipe corrections into the existing `fp_observations` path with the somm reliability weight already established.

## Surface 3 — Brief redesign

Replace `SommelierBriefDialog` with a full-screen route.

- New route: `src/routes/brief.$username.tsx` — public, SSR-off. Fetches `buildFullBrief` via existing server fn. Forces service theme locally. Landscape-supported (no rotation lock; layout works at both orientations).
- Structure exactly:
  1. Archetype name — `--fs-title`
  2. "What they love" — one sentence at `--fs-body` (line 1 of the existing brief, stripped of any scored language)
  3. Two benchmark bottles — full name, no truncation, `--fs-body` bold
  4. One steer-me-away sentence — `--fs-body`
- Nothing else on screen. No app chrome, no back button until dismissed (tap-and-hold for 400ms to exit — prevents accidental dismiss when handing across a table).
- Contrast pass: verify each color pair against `--bg-service` at 7:1. Add a `pm-service-locked` CSS class that forces service tokens regardless of user theme.
- **Guest side**: add "Hand to your sommelier" button on `SommelierBriefCard` that navigates to `/brief/<own-username>?locked=1`, which enables the tap-and-hold-to-exit gate.
- Retire `SommelierBriefDialog` after callers migrate; keep a redirect shim for one release.

## Privacy invariants (enforced server-side, tested)

- `resolveGuestToken` returns archetype + palate codes (already public shareable metadata via `palate_shareable`) + visibility. Never anchors, never ratings, never the full quiz answers.
- `callTable` returns per-person classifications (`loves` | `fine` | `not-for-them`) — an ordinal, not a score. The full prediction number stays server-side.
- If a guest's `visibility = 'private'`, `resolveGuestToken` refuses and the chip cannot be added.

## Tests

- `somm-copy.test.ts` — grep every user-facing string in `/somm/**` against forbidden vocabulary.
- `table-call.test.ts` — three fixtures (safe convergence / lopsided / split needed) assert the correct call kind and reasoning sentence.
- `house-list-diff.test.ts` — assert "6 added, 2 gone, 4 price changes" wording against a known pair of versions.
- `brief-contrast.test.ts` — assert every text/bg token pair in the brief route computes ≥ 7:1 against `--bg-service`.

## Order of work (five commits)

1. Migration + RLS + grants for the four house_list tables.
2. Server fns: `resolveGuestToken`, `callTable`, `saveHouseListVersion`, `setOutOfStock`, `correctListItem`.
3. `/somm` layout + landing + `/somm/table` full flow.
4. `/somm/list` (list, versioning, OOS, correction).
5. `/brief/$username` full-screen + guest "Hand to your sommelier" button + retire `SommelierBriefDialog`.

## Acceptance verification

- Cold-start timing: from `/somm` tap → table call with 4 guests via short codes → measured via manual walkthrough script, target ≤ 45s.
- Contrast: automated in `brief-contrast.test.ts`.
- Vocabulary: automated in `somm-copy.test.ts`.
- OOS: fixture in `table-call.test.ts` marks a wine OOS and asserts it never appears.
- Guest data leakage: assert `resolveGuestToken` response shape has no anchor/rating fields.

## Out of scope for this build

- Group table history / audit log — sommelier tools should not remember what a specific table drank without consent.
- Multi-establishment for one sommelier — v1 assumes one establishment per profile.
- Guest QR generator UI — v1 accepts short codes / links / username; QR generator ships in a follow-up when we have designer input on print sizing.
