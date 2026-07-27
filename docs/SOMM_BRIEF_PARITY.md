# Somm guest brief — full palate-code parity (Option A, follow-up)

**Status: drafted, not applied.** The table screen currently ships the *lighter*
brief (`src/lib/somm-quick-brief.ts` via `sommGuestBrief`): a sensory line +
benchmark loves/avoids, built only from the consent bundle (fingerprints +
stars + benchmark flags). It needs no schema change.

This doc upgrades that to the **same brief the guest sees** (`buildFullBrief`),
which additionally needs each rated bottle's **axis values incl. `ax_sweet`** —
data the consent bundle does not currently return. Sweetness can't be derived
from fingerprints, so faking it would violate the "estimated attributes are
always flagged" invariant. Hence a schema step.

Apply the two steps together; do not apply Step 1 alone (harmless, but unused).

---

## Step 1 — extend the consent RPC (SQL migration)

`somm_load_guest_scoring_bundle` gains the five axis columns. A `RETURNS TABLE`
signature can't be changed with `CREATE OR REPLACE`, so DROP first. The body is
unchanged except the added columns. Access control (verified somm + valid grant
or public+shareable) is untouched — same consent guarantees.

```sql
-- New migration file, e.g. supabase/migrations/<ts>_somm_brief_axes.sql
DROP FUNCTION IF EXISTS public.somm_load_guest_scoring_bundle(uuid, uuid);

CREATE OR REPLACE FUNCTION public.somm_load_guest_scoring_bundle(p_guest_id uuid, p_grant_id uuid)
 RETURNS TABLE(
   bottle_id uuid, name text, producer text, region text, type text, vintage integer,
   fp_fresh real, fp_acid real, fp_tannin real, fp_fruit_dark real,
   fp_ripe real, fp_oak real, fp_body real, fp_savory real,
   ax_body real, ax_fruit_char real, ax_tannin real, ax_acidity real, ax_sweet real,
   stars integer, canon boolean, nemesis boolean)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_status text; v_ok boolean := false; v_visibility text; v_shareable boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT p.somm_status INTO v_status FROM public.profiles p WHERE p.id = v_uid;
  IF v_status IS DISTINCT FROM 'verified' THEN RAISE EXCEPTION 'verified sommeliers only'; END IF;

  IF p_grant_id IS NOT NULL THEN
    SELECT true INTO v_ok FROM public.somm_consent_grants AS g
     WHERE g.id = p_grant_id AND g.guest_id = p_guest_id
       AND g.granted_to_somm_id = v_uid AND g.expires_at > now();
  END IF;
  IF NOT COALESCE(v_ok, false) THEN
    SELECT p.visibility, p.palate_shareable INTO v_visibility, v_shareable
      FROM public.profiles p WHERE p.id = p_guest_id;
    IF v_visibility = 'public' AND v_shareable = true THEN v_ok := true; END IF;
  END IF;
  IF NOT COALESCE(v_ok, false) THEN RAISE EXCEPTION 'no active consent for this guest'; END IF;

  RETURN QUERY
    SELECT b.id, b.name, b.producer, b.region, b.type, b.vintage,
           b.fp_fresh, b.fp_acid, b.fp_tannin, b.fp_fruit_dark,
           b.fp_ripe, b.fp_oak, b.fp_body, b.fp_savory,
           b.ax_body, b.ax_fruit_char, b.ax_tannin, b.ax_acidity, b.ax_sweet,
           r.stars,
           EXISTS (SELECT 1 FROM public.canon_wines c
                    WHERE c.user_id = p_guest_id AND c.bottle_id = b.id
                      AND c.tier = 'canon' AND c.replaced_at IS NULL) AS canon,
           EXISTS (SELECT 1 FROM public.canon_wines c
                    WHERE c.user_id = p_guest_id AND c.bottle_id = b.id
                      AND c.tier = 'nemesis' AND c.replaced_at IS NULL) AS nemesis
      FROM public.ratings r
      JOIN public.bottles b ON b.id = r.bottle_id
     WHERE r.user_id = p_guest_id;
END $function$;
```

## Step 2 — wire the code

In `src/lib/somm.functions.ts`:

1. In `loadGuestRatedFpViaConsent`, capture the axis values per row into a
   parallel structure keyed by bottle id:
   `values = { body: r.ax_body, fruit_char: r.ax_fruit_char, tannin: r.ax_tannin, acidity: r.ax_acidity, sweet: r.ax_sweet }`.
   (Aggregation via `aggregateRated` is cuvée-level; carry the axis values on the
   aggregated row, or aggregate them the same way as fp.)
2. Add a `sommGuestFullBrief` server fn (mirrors `sommGuestBrief`, same consent
   call) that assembles `FullBriefInputs`:
   - `rated: RatedBottle[]` per type = `{ stars, values, canon }`
   - `ratedFp: RatedFp[]` per type = the existing objects
   - `canons` / `nemeses`: `BriefBenchmark[]` from the canon/nemesis rows
     (`{ id, bottleId, name, producer, region, fp, createdAt }`)
   then `return buildFullBrief({ red, white })`.
3. Swap `GuestBriefPanel` in `src/routes/somm.table.tsx` to call the full brief
   and render `brief.paragraphs` (drop the footer line for the somm surface).

## Verification

Can't be verified without a signed-in verified somm + a guest with a valid
consent grant. Confirm: (a) the brief text matches what the guest sees on their
own `/brief`, minus the footer; (b) red and white stay separate; (c) an expired
grant still raises `no active consent for this guest`.
