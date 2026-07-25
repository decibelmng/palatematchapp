# Phase D — Earned evidence-weight (shadow, dormant)

Status: **shadow-only.** Infrastructure ships in the Profiles & Somm Trust Tier
migration, but no live catalog corrections come from it at current volume.

## What ships

- `public.user_reliability` table — per-user reliability score `ρ ∈ [0,1]`.
- `public.admin_reliability_recompute()` — service-role-only. Computes ρ from
  agreement with per-bottle consensus (mean rating) among **high-consensus**
  wines (≥ 8 raters). **Reads only ratings.** Never reads followers, share
  counts, wines-starred, or any social metric.
- `public.submit_somm_observation(bottle_id, axis, value, rationale)` — writes
  to `fp_observations` with `precision = base(tier) · ρ`, `mode='shadow'`,
  `source_type='somm_verified'` when the caller is verified, else `'user'`.
- New column `fp_observations.reliability_at_write` — snapshots ρ for replay.

## The line

- **Verification** (Phase B — the SOMM badge) grants **status only**. No
  `fp_observations.precision` value branches on `somm_status`; only the base
  factor in `submit_somm_observation` does, and that RPC is not wired to any
  UI yet.
- **Calibration** (this phase) grants **weight**. λ decays as ρ falls, so a
  somm whose calls chronically miss consensus loses influence regardless of
  the badge.
- **Guardrails still apply** — the 25% per-bottle influence cap, the Σλ ≥ 5
  evidence floor, the 0.10 move cap, the immutable prior, and the shadow →
  validation → live promotion pathway from Phase 4 all still gate any actual
  fingerprint movement. `admin_fp_recompute_bottle` is unchanged.

## Why dormant

`admin_consensus_gate_status()` still returns `global_pass = false` (needs
≥ 500 ratings and ≥ 25 users). Until then, shadow observations do not
promote to live and no fingerprint moves.

## When we open the tap

1. Rating volume crosses the Phase-4 gate.
2. Wire a UI for verified somms to submit corrections through
   `submit_somm_observation`. **Do not** widen the RPC's caller check —
   badge alone should never bypass ρ.
3. Run `admin_reliability_recompute()` on a cadence (nightly).
4. Any promoted correction must still beat priors on held-out prediction
   via `admin_consensus_validate` before flipping to `mode='live'`.

## Anti-corruption invariants (grep-checkable)

- `recommender.ts` and the `admin_fp_*` functions do not reference `follows`,
  `follower_count`, `share_count`, or any social metric.
- No code path sets `fp_observations.precision` from `somm_status` directly;
  it always flows through `submit_somm_observation` where ρ is applied.
