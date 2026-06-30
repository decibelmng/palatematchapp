ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS palate_code_red text NOT NULL DEFAULT '·····',
  ADD COLUMN IF NOT EXISTS palate_code_white text NOT NULL DEFAULT '·····';