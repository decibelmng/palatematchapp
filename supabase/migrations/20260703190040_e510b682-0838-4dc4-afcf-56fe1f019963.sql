
ALTER TABLE public.bottles
  ADD COLUMN IF NOT EXISTS refingerprinted_at timestamptz,
  ADD COLUMN IF NOT EXISTS fp_harmonized_at timestamptz;

-- Step A: default-aware harmonization within each cuvée group
WITH g AS (
  SELECT
    id,
    lower(coalesce(producer,'')) AS gp,
    regexp_replace(regexp_replace(lower(name), '\y(19|20)\d{2}\y', '', 'g'), '\s+', ' ', 'g') AS gn,
    lower(coalesce(type,'')) AS gt,
    lower(coalesce(region,'')) AS gr,
    fp_fresh, fp_acid, fp_tannin, fp_fruit_dark, fp_ripe, fp_oak, fp_body, fp_savory
  FROM public.bottles
),
sizes AS (
  SELECT gp,gn,gt,gr FROM g GROUP BY gp,gn,gt,gr HAVING count(*) > 1
),
m AS (
  SELECT g.gp, g.gn, g.gt, g.gr,
    coalesce(percentile_cont(0.5) WITHIN GROUP (ORDER BY g.fp_fresh)      FILTER (WHERE abs(g.fp_fresh-0.5)      > 0.02), percentile_cont(0.5) WITHIN GROUP (ORDER BY g.fp_fresh))      AS m_fresh,
    coalesce(percentile_cont(0.5) WITHIN GROUP (ORDER BY g.fp_acid)       FILTER (WHERE abs(g.fp_acid-0.5)       > 0.02), percentile_cont(0.5) WITHIN GROUP (ORDER BY g.fp_acid))       AS m_acid,
    coalesce(percentile_cont(0.5) WITHIN GROUP (ORDER BY g.fp_tannin)     FILTER (WHERE abs(g.fp_tannin-0.5)     > 0.02), percentile_cont(0.5) WITHIN GROUP (ORDER BY g.fp_tannin))     AS m_tannin,
    coalesce(percentile_cont(0.5) WITHIN GROUP (ORDER BY g.fp_fruit_dark) FILTER (WHERE abs(g.fp_fruit_dark-0.5) > 0.02), percentile_cont(0.5) WITHIN GROUP (ORDER BY g.fp_fruit_dark)) AS m_fruit_dark,
    coalesce(percentile_cont(0.5) WITHIN GROUP (ORDER BY g.fp_ripe)       FILTER (WHERE abs(g.fp_ripe-0.5)       > 0.02), percentile_cont(0.5) WITHIN GROUP (ORDER BY g.fp_ripe))       AS m_ripe,
    coalesce(percentile_cont(0.5) WITHIN GROUP (ORDER BY g.fp_oak)        FILTER (WHERE abs(g.fp_oak-0.5)        > 0.02), percentile_cont(0.5) WITHIN GROUP (ORDER BY g.fp_oak))        AS m_oak,
    coalesce(percentile_cont(0.5) WITHIN GROUP (ORDER BY g.fp_body)       FILTER (WHERE abs(g.fp_body-0.5)       > 0.02), percentile_cont(0.5) WITHIN GROUP (ORDER BY g.fp_body))       AS m_body,
    coalesce(percentile_cont(0.5) WITHIN GROUP (ORDER BY g.fp_savory)     FILTER (WHERE abs(g.fp_savory-0.5)     > 0.02), percentile_cont(0.5) WITHIN GROUP (ORDER BY g.fp_savory))     AS m_savory
  FROM g
  JOIN sizes s USING (gp,gn,gt,gr)
  GROUP BY g.gp, g.gn, g.gt, g.gr
)
UPDATE public.bottles b
SET fp_fresh      = m.m_fresh,
    fp_acid       = m.m_acid,
    fp_tannin     = m.m_tannin,
    fp_fruit_dark = m.m_fruit_dark,
    fp_ripe       = m.m_ripe,
    fp_oak        = m.m_oak,
    fp_body       = m.m_body,
    fp_savory     = m.m_savory,
    fp_harmonized_at = now()
FROM g
JOIN m USING (gp,gn,gt,gr)
WHERE b.id = g.id;

-- Step B: rebuild derived ax_* from fp_* (single source of truth)
UPDATE public.bottles
SET ax_body      = fp_body,
    ax_tannin    = fp_tannin,
    ax_acidity   = fp_acid,
    ax_fruit_char = fp_savory;
