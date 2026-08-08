ALTER TABLE public.bottles
  ADD COLUMN IF NOT EXISTS fingerprint_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz;

COMMENT ON COLUMN public.bottles.fingerprint_attempts IS
  'Every scoring attempt for this row, success or failure. refingerprinted_at only records successes, which made a gateway failure indistinguishable from never having been tried — and the rating that triggered it fires once.';

UPDATE public.bottles
   SET fingerprint_attempts = 1, last_attempt_at = refingerprinted_at
 WHERE refingerprinted_at IS NOT NULL AND fingerprint_attempts = 0;

-- Duplicate merge: Château Smith Haut Lafitte 2014 (Pessac-Léognan, red).
DO $$
DECLARE
  v_surv uuid := 'fa331b36-8ac5-4bc9-ac66-fcc9a2615bab';
  v_dup  uuid := 'e0be36e3-0aae-43e0-bdab-04361f83ca83';
  v_refs integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.bottles WHERE id = v_dup) THEN
    RETURN;
  END IF;

  UPDATE public.ratings            SET bottle_id = v_surv WHERE bottle_id = v_dup;
  UPDATE public.canon_wines        SET bottle_id = v_surv WHERE bottle_id = v_dup;
  UPDATE public.wishlist           SET bottle_id = v_surv WHERE bottle_id = v_dup;
  UPDATE public.scan_wines         SET matched_bottle_id = v_surv WHERE matched_bottle_id = v_dup;
  UPDATE public.restaurant_wines   SET bottle_id = v_surv WHERE bottle_id = v_dup;
  UPDATE public.price_observations SET bottle_id = v_surv WHERE bottle_id = v_dup;
  UPDATE public.house_list_items   SET bottle_id = v_surv WHERE bottle_id = v_dup;
  UPDATE public.house_list_stock   SET bottle_id = v_surv WHERE bottle_id = v_dup;
  UPDATE public.fp_disputes        SET bottle_id = v_surv WHERE bottle_id = v_dup;

  DELETE FROM public.fp_observations WHERE bottle_id = v_dup;
  DELETE FROM public.prediction_outcomes WHERE bottle_id = v_dup;
  DELETE FROM public.catalog_corrections WHERE bottle_id = v_dup;
  DELETE FROM public.bottles WHERE id = v_dup;

  SELECT count(*) INTO v_refs FROM public.ratings WHERE bottle_id = v_dup;
  IF v_refs <> 0 THEN
    RAISE EXCEPTION 'orphan ratings after Smith Haut Lafitte merge: %', v_refs;
  END IF;

  INSERT INTO public.catalog_corrections
    (bottle_id, field, old_value, new_value, source_type, rationale)
  VALUES (
    v_surv, 'duplicate_merge', v_dup::text, v_surv::text, 'expert_admin',
    'Château Smith Haut Lafitte 2014 duplicate created by the name backfill: the original bad name blocked identity dedup at insert time. Surviving row carries the per-wine blinded style reading; removed row was grid-derived with no references.'
  );
END $$;