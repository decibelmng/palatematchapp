
ALTER TABLE public.bottles
  ALTER COLUMN fp_model SET NOT NULL,
  ALTER COLUMN fp_prompt_hash SET NOT NULL,
  ALTER COLUMN fp_pipeline SET NOT NULL,
  ALTER COLUMN fp_scored_at SET NOT NULL;

CREATE INDEX IF NOT EXISTS bottles_fp_pipeline_idx ON public.bottles(fp_pipeline);
CREATE INDEX IF NOT EXISTS bottles_fp_prompt_hash_idx ON public.bottles(fp_prompt_hash);
CREATE INDEX IF NOT EXISTS bottles_fp_job_id_idx ON public.bottles(fp_job_id) WHERE fp_job_id IS NOT NULL;
