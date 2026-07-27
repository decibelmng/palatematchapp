# Catalog re-fingerprint (Track E)

The v1 catalog fingerprints are a (grape, region, vintage) typicity grid, not
per-wine values — so the engine can't tell two Barolos apart. This is the plan
to replace them with fingerprints derived from real per-wine tasting notes.

**Golden rule (from CLAUDE.md):** never mix calibrations. A half-corrected
catalog is worse than a uniformly-wrong one, because the distance between a
corrected wine and an uncorrected one becomes an artifact of which batch it
was in. So: build the new set in *shadow* storage, prove it, then swap it in
one atomic transaction.

## Stages

| # | Stage | Cost | Gate |
|---|-------|------|------|
| 0 | Shadow storage (staging table now; shadow fp_* columns at Stage 4) | — | — |
| **1** | **Rejoin real Kaggle tasting notes to catalog bottles** | free | how many matched? |
| 2 | Strip grape/named-wine anchors from the blind scorer prompt | free | — |
| 3 | Pilot: re-score ~78 wines, measure **within-region discrimination** | ~$1 | **go/no-go** |
| 4 | Full re-fingerprint of matched wines → shadow columns | ~$665 | — |
| 5 | Atomic swap into live fp_*, bump `palate_version`, flag un-matched wines "estimated" | — | — |
| 6 | Validate against a real restaurant wine list | — | does the Call pick the human's bottle? |

The pilot gate (Stage 3) is **within-region variance going UP** — can two
different Barolos be told apart? — NOT between-region separation, which a grid
already does. The last pilot failed because the scorer prompt still carried
grape-calibration bands; Stage 2 removes them.

---

## Stage 1 — the Kaggle rejoin (do this first; it's free and it's the blocker)

`scripts/kaggle-rejoin.ts` matches rows of `winemag-data-130k-v2.csv` (Kaggle;
column `description` = a real human tasting note) to your `bottles` by
normalized **producer + vintage + grape**, confirmed by wine-name similarity.
It is **DRY-RUN by default** — it writes a report and touches nothing. With
`--write` it upserts only into a **staging table** (`catalog_kaggle_notes`);
it never writes `bottles`, and never touches `fp_*`.

### Step 1a — create the staging table (apply once, via Supabase SQL editor)

```sql
CREATE TABLE IF NOT EXISTS public.catalog_kaggle_notes (
  bottle_id       uuid PRIMARY KEY REFERENCES public.bottles(id) ON DELETE CASCADE,
  kaggle_title    text NOT NULL,
  description     text NOT NULL,   -- the real per-wine tasting note
  points          integer,         -- Kaggle critic score, if present
  match_confidence real NOT NULL,  -- 0..1 (see the script)
  matched_at      timestamptz NOT NULL DEFAULT now()
);
-- Staging only; no RLS policies needed (service-role writes, no client reads).
ALTER TABLE public.catalog_kaggle_notes ENABLE ROW LEVEL SECURITY;
```

### Step 1b — get the data
Download `winemag-data-130k-v2.csv` from Kaggle
("Wine Reviews" by zackthoutt) to your machine.

### Step 1c — dry run (matches nothing yet — just a report)

```bash
SUPABASE_URL='https://xyxanewatmrekdqowqao.supabase.co' \
SUPABASE_SERVICE_ROLE_KEY='<your service-role key>' \
bun run scripts/kaggle-rejoin.ts ~/Downloads/winemag-data-130k-v2.csv
```

It prints: total bottles, how many matched, the match-rate, a confidence
histogram, ~20 sample matches (bottle ↔ Kaggle title + score) to eyeball
quality, and ~10 unmatched samples. **Read the samples** — if the matches look
wrong, raise the threshold; if too few, lower it:

```bash
... bun run scripts/kaggle-rejoin.ts <csv> --min=0.62   # default is 0.72
```

### Step 1d — write to staging (only once the samples look right)

```bash
... bun run scripts/kaggle-rejoin.ts <csv> --write --min=0.72
```

This upserts the recovered notes into `catalog_kaggle_notes`. Nothing else
changes. Report back the **match count** — that's decision point #1 (coverage),
and it tells us whether Stage 3's pilot is worth running.

> The service-role key is a **secret** — never paste it into chat or commit it.
> Run these commands in your own terminal only.
