ALTER TABLE public.bottles
  ALTER COLUMN fp_fresh_prior      SET DEFAULT 0.5,
  ALTER COLUMN fp_acid_prior       SET DEFAULT 0.5,
  ALTER COLUMN fp_tannin_prior     SET DEFAULT 0.5,
  ALTER COLUMN fp_fruit_dark_prior SET DEFAULT 0.5,
  ALTER COLUMN fp_ripe_prior       SET DEFAULT 0.5,
  ALTER COLUMN fp_oak_prior        SET DEFAULT 0.5,
  ALTER COLUMN fp_body_prior       SET DEFAULT 0.5,
  ALTER COLUMN fp_savory_prior     SET DEFAULT 0.5;