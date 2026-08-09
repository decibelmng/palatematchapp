-- Vintage-mismatch remediation — REPORT ONLY. No writes. Nothing here moves a
-- rating. A rating is the owner's judgment attached to a wine they may not have
-- drunk, so every repoint is confirmed by hand from this report.
--
-- Run: psql -f scripts/vintage-remediation.sql
--
-- Section 1 — scope: every scan line whose matched catalog row is a different
-- vintage than the list showed, split by whether the correct vintage even
-- exists in the catalog today.
WITH bad AS (
  SELECT sw.id AS scan_wine_id, sw.user_id, sw.scan_id,
         sw.producer, sw.cuvee, sw.vintage AS scanned_vintage, sw.wine_type,
         b.id AS matched_bottle_id, b.producer AS b_producer, b.name AS b_name,
         b.vintage AS matched_vintage, b.type AS b_type,
         abs(sw.vintage - b.vintage) AS years_apart
  FROM public.scan_wines sw
  JOIN public.bottles b ON b.id = sw.matched_bottle_id
  WHERE sw.vintage IS NOT NULL AND b.vintage IS NOT NULL AND sw.vintage <> b.vintage
),
resolvable AS (
  SELECT bad.*, (
    SELECT x.id FROM public.bottles x
    WHERE x.vintage = bad.scanned_vintage
      AND x.type = bad.b_type
      AND coalesce(lower(x.producer), '') = coalesce(lower(bad.b_producer), '')
    ORDER BY word_similarity(coalesce(bad.b_name, ''), coalesce(x.name, '')) DESC
    LIMIT 1
  ) AS correct_vintage_bottle_id
  FROM bad
)
SELECT count(*) AS mismatched_lines,
       count(DISTINCT matched_bottle_id) AS distinct_wrong_bottles,
       count(correct_vintage_bottle_id) AS correct_vintage_row_exists,
       count(*) - count(correct_vintage_bottle_id) AS needs_on_demand_resolve,
       round(avg(years_apart)::numeric, 1) AS avg_years_apart,
       max(years_apart) AS max_years_apart
FROM resolvable;

-- Section 2 — the only rows that carry judgment: a rating, a prediction
-- outcome, or a benchmark/dealbreaker on the wrongly matched bottle.
-- These are the confirm-by-hand queue.
WITH bad AS (
  SELECT sw.id AS scan_wine_id, sw.user_id, sw.vintage AS scanned_vintage,
         b.id AS matched_bottle_id, b.producer AS b_producer, b.name AS b_name,
         b.vintage AS matched_vintage, b.type AS b_type
  FROM public.scan_wines sw
  JOIN public.bottles b ON b.id = sw.matched_bottle_id
  WHERE sw.vintage IS NOT NULL AND b.vintage IS NOT NULL AND sw.vintage <> b.vintage
)
SELECT DISTINCT
  bad.b_producer, bad.b_name,
  bad.scanned_vintage, bad.matched_vintage,
  r.stars,
  (r.user_id = bad.user_id) AS rated_by_the_scanner,
  (SELECT count(*) FROM public.canon_wines c
     WHERE c.bottle_id = bad.matched_bottle_id AND c.replaced_at IS NULL) AS benchmark_rows,
  (SELECT count(*) FROM public.prediction_outcomes po
     WHERE po.bottle_id = bad.matched_bottle_id) AS prediction_rows,
  (SELECT x.id FROM public.bottles x
    WHERE x.vintage = bad.scanned_vintage AND x.type = bad.b_type
      AND coalesce(lower(x.producer), '') = coalesce(lower(bad.b_producer), '')
    LIMIT 1) AS correct_vintage_bottle_id
FROM bad
JOIN public.ratings r ON r.bottle_id = bad.matched_bottle_id
ORDER BY r.stars DESC;

-- Section 3 — distribution of how far off the matcher was, so the fix can be
-- graded rather than treated as one bucket.
WITH bad AS (
  SELECT abs(sw.vintage - b.vintage) AS years_apart
  FROM public.scan_wines sw
  JOIN public.bottles b ON b.id = sw.matched_bottle_id
  WHERE sw.vintage IS NOT NULL AND b.vintage IS NOT NULL AND sw.vintage <> b.vintage
)
SELECT CASE
         WHEN years_apart <= 2 THEN '1-2y (near-miss)'
         WHEN years_apart <= 5 THEN '3-5y'
         WHEN years_apart <= 10 THEN '6-10y'
         ELSE '11y+ (different wine)'
       END AS band,
       count(*) AS lines
FROM bad GROUP BY 1 ORDER BY 1;
