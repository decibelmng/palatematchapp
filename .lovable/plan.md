
# Profiles & Somm Trust Tier — build plan (A + B + C + D shadow)

Governing principle preserved end-to-end: **payment buys the badge, calibration earns the weight, social metrics never touch the engine.** Phases B and D are structurally isolated — B never sets a λ.

---

## Migration (single migration, four table/column groups)

### profiles — new columns
- `visibility` text default `'private'`, check in (`private`,`followers`,`public`)
- `somm_status` text default `'none'`, check in (`none`,`pending`,`verified`,`revoked`)
- `somm_role` text (`sommelier` / `store_owner` / `beverage_lead` / `other`)
- `establishment` text
- `verified_at` timestamptz, `verified_by` uuid, `bypass_code_used` text
- `avatar_url` text (if not already present)
- `bio` text (short, optional — surfaces on profile card)

### somm_invite_codes (new)
- `code` text primary key, `issued_by` uuid, `used_by` uuid null, `used_at` timestamptz null, `created_at` timestamptz default now(), `note` text
- RLS: no anon; authenticated select own issued/used rows; only service_role writes. Redemption goes through a SECURITY DEFINER RPC `redeem_somm_code(p_code text)` that atomically claims the code and sets `somm_status='verified'`.

### follows (new, directed)
- `follower_id`, `followee_id`, `status` text (`accepted`,`pending`), `created_at`, `responded_at`
- Unique (follower_id, followee_id). RLS:
  - INSERT: `auth.uid()=follower_id`; if followee visibility is `public`, insert as `accepted`; else `pending`. Enforced in RPC `follow_user(p_followee uuid)`.
  - SELECT: either side.
  - UPDATE (accept/reject): followee only.
  - DELETE (unfollow / cancel): either side.
- `search_users` already exists; add `follow_user`, `unfollow_user`, `respond_follow`.

### fp_observations — Phase D fields
- Add `reliability_at_write real` (snapshot of author's ρ at write time — replayable).
- New source_type values allowed by string convention (no CHECK change needed): `somm_verified`.

### user_reliability (new, Phase D)
- `user_id` primary key, `rho real default 1.0`, `n_holdout int default 0`, `updated_at`
- Populated by `admin_reliability_recompute()` — a SECURITY DEFINER function that scores each user against consensus-holdout wines from the Phase-4 machinery. **Reads only ratings vs consensus, never social metrics.**
- λ formula for future somm-driven fp_observations writes: `precision = base(tier) * rho`, where `base(standard)=1`, `base(verified_somm)=3`. Applied in a new `submit_somm_observation` RPC (mirrors admin correction path but tagged `mode='shadow'` and `source_type='somm_verified'`). **No UI wired yet** — table + function exist; kept dormant until Phase-4 volume gate passes.

### Grants (every new public table, in the migration)
- `authenticated`: read own rows + accepted follows both directions; grants scoped to policies.
- `service_role`: ALL.
- `anon`: SELECT on `follows` counts via a view? — no: counts derive from server fns that use `requireSupabaseAuth`. **Public profile read** goes through a SECURITY DEFINER RPC `get_public_profile(p_username text)` that returns only the fields the visibility setting allows.

---

## Phase A — Palate tab becomes the profile

`src/routes/palate.index.tsx` refactor:
- Top block: avatar, display name (edit inline), member-since, **badge slot** (renders SOMM chip when `somm_status='verified'`).
- **Inline** 2D/3D toggle over the existing map/cube — no reveal gate for returning users (the reveal flow stays only for first-time users with < 5 ratings).
- Stats row: rated / canons / nemeses / current streak (`max(created_at)` window). Values come from existing hooks.
- Visibility control (private/followers/public radio) + Share button placeholder (Phase C wires it).
- New `ProfileHeader.tsx`, `ProfileStats.tsx`, `VisibilityControl.tsx`, `SommBadge.tsx` under `src/components/profile/`.

Acceptance: viz renders inline on load; no email/precise-location anywhere; default visibility persists as `private`.

---

## Phase B — SOMM badge + verification (status only, zero engine influence)

- New route `src/routes/palate.verify.tsx` — "Verify as a somm" form: role, establishment, invite code.
- Calls `redeem_somm_code` RPC. Success → toast, `somm_status='verified'`, badge shows.
- **Assertion in code**: `redeem_somm_code` only writes to `profiles`. A unit-style comment + a runtime assertion in a `scripts/assert-badge-no-influence.ts` grep test verifies no code path branches `fp_observations.precision` on `somm_status`. (Phase D writes go through `submit_somm_observation` which reads reliability, not badge alone.)
- Payment stub: an "Upgrade to SOMM" section that only shows the invite-code path for now.

---

## Phase C — Share + follows

- Share button on profile → uses `navigator.share` if available, else copies `${origin}/u/${username}` to clipboard.
- New public route `src/routes/u.$username.tsx` (top-level, SSR **on**, no auth gate). Loader calls a **public** server fn that invokes `get_public_profile` RPC with a server-side publishable client. Returns minimal card for private, followers-only for followers, full for public. Renders `head()` OG tags with display name + palate codes.
- Follow button: shows Follow/Requested/Following. Uses `follow_user` / `unfollow_user`.
- Counts: follower/following via server fn `getFollowCounts(userId)` — cheap `count` selects.
- Anti-gaming grep: `scripts/assert-social-not-in-engine.ts` fails if `recommender.ts`, `fp_observations` migrations, or `admin_fp_recompute_*` reference `follows` / `follower_count` / `share_count`.

---

## Phase D — Earned evidence-weight (shadow, dormant)

Infrastructure only. **No UI to submit somm observations yet.** Ships:

- `user_reliability` table + `admin_reliability_recompute()` computing ρ from consensus-holdout agreement (uses the Phase-4 surprise machinery inverted — agreement not disagreement).
- `submit_somm_observation(bottle_id, axis, value, rationale)` — SECURITY DEFINER RPC that writes to `fp_observations` with `precision = base(tier) * rho`, `mode='shadow'`, `reliability_at_write=rho`, `source_type='somm_verified'`. Applies existing guardrails via reuse of `admin_fp_recompute_bottle` (25% cap, floor, move cap already enforced there).
- Validation reuses `admin_consensus_validate` — a shadow somm observation only promotes to `mode='live'` when it beats the prior on held-out prediction.
- At current volume: `admin_consensus_gate_status()` still returns `global_pass=false`, so zero live promotions. Documented in a `PHASE_D_DORMANT.md` under `docs/`.

---

## Acceptance matrix (executable where possible)

- **A**: Palate tab renders profile + inline viz (screenshot); visibility persists (SQL check on `profiles.visibility`); no email/location strings in rendered HTML (grep of route).
- **B**: valid bypass code → `somm_status='verified'`; invalid → no change. Grep confirms `fp_observations.precision` unchanged by badge.
- **C**: public follow accepts instantly; private follow creates `pending`; social metrics grep passes.
- **D**: `submit_somm_observation` writes with precision = base·ρ (asserted with a fixture SQL); consensus gate still fails → zero live promotions.

---

## Files touched

- New migration: `phases-abcd-profiles-somm.sql` (single migration).
- Routes: `palate.index.tsx` (rewrite), `palate.verify.tsx` (new), `u.$username.tsx` (new).
- Components: `src/components/profile/{ProfileHeader,ProfileStats,VisibilityControl,SommBadge,FollowButton,ShareProfileButton}.tsx`.
- Server fns: `src/lib/profile.functions.ts`, `src/lib/follows.functions.ts`.
- Docs/asserts: `docs/PHASE_D_DORMANT.md`, `scripts/assert-social-not-in-engine.ts`, `scripts/assert-badge-no-influence.ts`.
- No edits to `recommender.ts`, `admin_fp_recompute_*`, or existing fp_observations write paths.

## Order I'll execute

1. Migration (approval gate — types regenerate after).
2. Phase A UI on the new columns.
3. Phase B verify route + badge.
4. Phase C public profile route + follows UI.
5. Phase D docs + grep asserts (infra already in the migration).
