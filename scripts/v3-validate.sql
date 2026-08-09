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

-- ─────────────────────────────────────────────────────────────
-- POST-SWAP GATE 2 (approved 2026-08-09): discrimination, not luck.
-- corr(ripe, body) across the owner's rated reds must fall well below 0.80.
-- Pre-swap measurement: 0.803 on v2 fingerprints.
-- ─────────────────────────────────────────────────────────────
with u as (select user_id from ratings group by 1 order by count(*) desc limit 1),
     r as (
       select b.fp_ripe_v3::double precision as ripe,
              b.fp_body_v3::double precision as body
       from ratings rt join u on u.user_id = rt.user_id
       join bottles b on b.id = rt.bottle_id
       where b.type = 'red'
         and b.fp_ripe_v3 is not null and b.fp_body_v3 is not null
     )
select count(*) as n_reds_v3,
       corr(ripe, body) as corr_ripe_body_v3,
       (corr(ripe, body) < 0.80) as gate2_pass
from r;

-- Same correlation on the v1/v2 columns, for the side-by-side.
with u as (select user_id from ratings group by 1 order by count(*) desc limit 1),
     r as (select b.fp_ripe::double precision ripe, b.fp_body::double precision body
           from ratings rt join u on u.user_id = rt.user_id
           join bottles b on b.id = rt.bottle_id where b.type = 'red')
select count(*) n_reds, corr(ripe, body) corr_ripe_body_pre from r;

-- ─────────────────────────────────────────────────────────────
-- POST-SWAP GATE 3: are the owner's own rated wines inside the swap?
-- A v2 rated set ranked against a v3 catalog is the same cross-calibration
-- failure with the populations swapped.
-- ─────────────────────────────────────────────────────────────
with u as (select user_id from ratings group by 1 order by count(*) desc limit 1)
select b.type,
       b.fp_pipeline,
       count(*) as rated,
       count(b.fp_v3_scored_at) as got_v3,
       count(*) - count(b.fp_v3_scored_at) as still_pre_v3,
       count(n.bottle_id) as has_source_note
from ratings rt join u on u.user_id = rt.user_id
join bottles b on b.id = rt.bottle_id
left join catalog_source_notes n on n.bottle_id = b.id
group by 1, 2 order by 3 desc;

-- Catalog-wide: rows that can never get v3 from this run (no tasting note).
select count(*) filter (where n.bottle_id is null) as no_note_rows,
       count(*) filter (where n.bottle_id is null and b.fp_pipeline like '%v2%') as no_note_v2_rows
from bottles b left join catalog_source_notes n on n.bottle_id = b.id;
