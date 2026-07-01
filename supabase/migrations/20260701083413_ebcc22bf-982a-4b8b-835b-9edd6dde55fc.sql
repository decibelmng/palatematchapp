UPDATE public.bottles b SET
  fp_fresh = s.fp_fresh, fp_acid = s.fp_acid, fp_tannin = s.fp_tannin,
  fp_fruit_dark = s.fp_fruit_dark, fp_ripe = s.fp_ripe, fp_oak = s.fp_oak,
  fp_body = s.fp_body, fp_savory = s.fp_savory,
  ax_body = s.ax_body, ax_fruit_char = s.ax_fruit_char, ax_tannin = s.ax_tannin,
  ax_acidity = s.ax_acidity, ax_sweet = s.ax_sweet,
  type = COALESCE(s.type, b.type),
  source = COALESCE(s.source, b.source)
FROM public.bottles_llm_staging s
WHERE lower(b.name) = lower(s.name)
  AND lower(coalesce(b.producer,'')) = lower(coalesce(s.producer,''))
  AND b.vintage IS NOT DISTINCT FROM NULLIF(s.vintage,'')::int;