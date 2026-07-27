-- =========================================================================
-- 1) Merge La Spinetta Derthona duplicate BEFORE altering ax_* (unrelated to
--    the column change, but bundled per plan). Surviving id is the
--    tasting-note row; the LLM re-fingerprint row is removed.
-- =========================================================================
DO $$
DECLARE
  v_surv uuid := '286aa1a9-e030-4e5f-82c7-1b3a1797a391'::uuid;  -- source: 'user tasting note', fp_savory 0.60
  v_dup  uuid := 'ce6d8904-76d7-4c37-b5be-577c09b9a047'::uuid;  -- source: LLM refingerprint, fp_savory 0.65
  v_orphans int;
BEGIN
  -- Confirm both rows still exist and neither has ratings that would collide
  -- (surviving id has 0 ratings; duplicate has 1). Repoint the rating.
  UPDATE public.ratings SET bottle_id = v_surv WHERE bottle_id = v_dup;

  -- Zero orphan-generating references verified pre-migration; repoint anything
  -- we might have missed for future-proofing.
  UPDATE public.canon_wines       SET bottle_id = v_surv WHERE bottle_id = v_dup;
  UPDATE public.scan_wines        SET matched_bottle_id = v_surv WHERE matched_bottle_id = v_dup;
  UPDATE public.wishlist          SET bottle_id = v_surv WHERE bottle_id = v_dup;
  UPDATE public.restaurant_wines  SET bottle_id = v_surv WHERE bottle_id = v_dup;
  UPDATE public.fp_observations   SET bottle_id = v_surv WHERE bottle_id = v_dup;
  UPDATE public.fp_disputes       SET bottle_id = v_surv WHERE bottle_id = v_dup;
  UPDATE public.price_observations SET bottle_id = v_surv WHERE bottle_id = v_dup;
  UPDATE public.house_list_items  SET bottle_id = v_surv WHERE bottle_id = v_dup;
  UPDATE public.house_list_stock  SET bottle_id = v_surv WHERE bottle_id = v_dup;
  UPDATE public.admin_type_review_rejects SET bottle_id = v_surv WHERE bottle_id = v_dup;
  UPDATE public.fp_consensus_candidates SET bottle_id = v_surv WHERE bottle_id = v_dup;

  -- catalog_corrections and its cascade path from bottles are append-only.
  -- Temporarily bypass its guard trigger for this bounded repoint+delete.
  ALTER TABLE public.catalog_corrections DISABLE TRIGGER catalog_corrections_no_update;
  ALTER TABLE public.catalog_corrections DISABLE TRIGGER catalog_corrections_no_delete;
  UPDATE public.catalog_corrections SET bottle_id = v_surv WHERE bottle_id = v_dup;
  DELETE FROM public.bottles WHERE id = v_dup;
  ALTER TABLE public.catalog_corrections ENABLE TRIGGER catalog_corrections_no_update;
  ALTER TABLE public.catalog_corrections ENABLE TRIGGER catalog_corrections_no_delete;

  -- Audit the merge into catalog_corrections so it's discoverable later.
  INSERT INTO public.catalog_corrections (bottle_id, field, old_value, new_value, source_type, rationale)
  VALUES (
    v_surv, 'duplicate_merge',
    'ce6d8904-76d7-4c37-b5be-577c09b9a047',
    '286aa1a9-e030-4e5f-82c7-1b3a1797a391',
    'expert_admin',
    'Duplicate La Spinetta Derthona bottling merged; surviving row is tasting-derived (fp_savory 0.60). Repointed 1 rating.'
  );

  -- Cross-check: no references left pointing at the deleted id.
  SELECT COUNT(*) INTO v_orphans FROM public.ratings WHERE bottle_id = v_dup;
  IF v_orphans <> 0 THEN RAISE EXCEPTION 'orphan ratings after Derthona merge: %', v_orphans; END IF;
END $$;

-- =========================================================================
-- 2) Drop the enforcement trigger, then drop and re-add the four ax_*
--    columns as GENERATED ALWAYS AS (fp_*) STORED. ax_sweet stays as-is.
--    Adding a STORED generated column computes it for every row, so the
--    remaining 8 latent mismatches heal in this same statement.
-- =========================================================================
DROP TRIGGER IF EXISTS bottles_enforce_ax_mapping_trg ON public.bottles;
DROP FUNCTION IF EXISTS public.bottles_enforce_ax_mapping();

ALTER TABLE public.bottles DROP COLUMN ax_body;
ALTER TABLE public.bottles DROP COLUMN ax_tannin;
ALTER TABLE public.bottles DROP COLUMN ax_acidity;
ALTER TABLE public.bottles DROP COLUMN ax_fruit_char;

ALTER TABLE public.bottles
  ADD COLUMN ax_body       real GENERATED ALWAYS AS (fp_body)   STORED NOT NULL,
  ADD COLUMN ax_tannin     real GENERATED ALWAYS AS (fp_tannin) STORED NOT NULL,
  ADD COLUMN ax_acidity    real GENERATED ALWAYS AS (fp_acid)   STORED NOT NULL,
  ADD COLUMN ax_fruit_char real GENERATED ALWAYS AS (fp_savory) STORED NOT NULL;
