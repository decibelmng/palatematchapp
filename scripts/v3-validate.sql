-- Full-catalog validation of the v3 shadow read. Run BEFORE the swap:
--   psql -f scripts/v3-validate.sql
-- Read-only. Nothing here writes.

\echo === coverage ===
select count(*) as scored,
       count(*) filter (where fp_v3_axes_read <= 3) as thin_or_worse,
       count(*) filter (where fp_v3_axes_read = 0)  as unreadable,
       round(avg(fp_v3_axes_read)::numeric, 2)      as mean_axes_read
from bottles where fp_v3_scored_at is not null;

\echo === null rate per axis ===
select round(100.0 * avg((fp_fresh_v3      is null)::int), 1) as fresh_null,
       round(100.0 * avg((fp_acid_v3       is null)::int), 1) as acid_null,
       round(100.0 * avg((fp_tannin_v3     is null)::int), 1) as tannin_null,
       round(100.0 * avg((fp_fruit_dark_v3 is null)::int), 1) as fruit_dark_null,
       round(100.0 * avg((fp_ripe_v3       is null)::int), 1) as ripe_null,
       round(100.0 * avg((fp_oak_v3        is null)::int), 1) as oak_null,
       round(100.0 * avg((fp_body_v3       is null)::int), 1) as body_null,
       round(100.0 * avg((fp_savory_v3     is null)::int), 1) as savory_null
from bottles where fp_v3_scored_at is not null;

\echo === within-region SD, v3 vs v1 (regions with >= 30 scored reds) ===
select region,
       count(*) as n,
       round(stddev_samp(fp_tannin_v3)::numeric, 3) as tannin_sd_v3,
       round(stddev_samp(fp_tannin)::numeric, 3)    as tannin_sd_v1,
       round(stddev_samp(fp_body_v3)::numeric, 3)   as body_sd_v3,
       round(stddev_samp(fp_body)::numeric, 3)      as body_sd_v1,
       round(stddev_samp(fp_savory_v3)::numeric, 3) as savory_sd_v3,
       round(stddev_samp(fp_savory)::numeric, 3)    as savory_sd_v1
from bottles
where fp_v3_scored_at is not null and type = 'red' and region is not null
group by region having count(*) >= 30
order by n desc limit 25;

\echo === within-grape SD, v3 vs v1 (grapes with >= 30 scored rows) ===
select grape,
       count(*) as n,
       round(stddev_samp(fp_ripe_v3)::numeric, 3)   as ripe_sd_v3,
       round(stddev_samp(fp_ripe)::numeric, 3)      as ripe_sd_v1,
       round(stddev_samp(fp_oak_v3)::numeric, 3)    as oak_sd_v3,
       round(stddev_samp(fp_oak)::numeric, 3)       as oak_sd_v1
from bottles
where fp_v3_scored_at is not null and grape is not null
group by grape having count(*) >= 30
order by n desc limit 25;
