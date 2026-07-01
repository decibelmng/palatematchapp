CREATE TABLE IF NOT EXISTS public.bottles_llm_staging (
  name text, producer text, region text, grape text, vintage int, price_band text,
  fp_fresh real, fp_acid real, fp_tannin real, fp_fruit_dark real, fp_ripe real,
  fp_oak real, fp_body real, fp_savory real,
  ax_body real, ax_fruit_char real, ax_tannin real, ax_acidity real, ax_sweet real,
  critic_score int, source text, type text
);
GRANT ALL ON public.bottles_llm_staging TO service_role;
TRUNCATE public.bottles_llm_staging;