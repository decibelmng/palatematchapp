UPDATE public.catalog_jobs
SET model = 'google/gemini-3.6-flash',
    row_count = (
      SELECT count(DISTINCT b.id)
      FROM public.bottles b
      JOIN public.catalog_source_notes n ON n.bottle_id = b.id
      WHERE n.ambiguous = false
    ),
    note = note || ' MODEL SETTLED: google/gemini-3.6-flash, chosen over google/gemini-2.5-flash on the 40-wine pilot (Napa Cab tannin SD 2.90x v1, 7/7 active axes up, mean 2.02x; acid null rate 70.0% vs 77.5%, savory 0% vs 10%; Corison-Caymus separation 0.926 vs 0.837 vs 0.586 on v1). 2.5-flash still resolves on the gateway but is superseded. SCOPE: bottles whose recovered review joins unambiguously (ambiguous joins excluded — one review that may describe a sibling bottle is the fabrication this pipeline removes, so those rows keep v1 until the join is resolved).'
WHERE id = 'fcf3b92a-0700-4a85-82a4-7d0d6b5af2a9';