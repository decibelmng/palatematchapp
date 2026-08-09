ALTER TABLE public.bottles ADD COLUMN IF NOT EXISTS fp_v3_pipeline text;

COMMENT ON COLUMN public.bottles.fp_v3_pipeline IS 'Shadow-run provenance: note_v3_deanchored (clean join) or note_v3_ambiguous_join (review could belong to a sibling bottle). Kept out of the Call alongside thin reads until the join is resolved.';

CREATE INDEX IF NOT EXISTS bottles_fp_v3_pipeline_idx ON public.bottles (fp_v3_pipeline) WHERE fp_v3_pipeline IS NOT NULL;