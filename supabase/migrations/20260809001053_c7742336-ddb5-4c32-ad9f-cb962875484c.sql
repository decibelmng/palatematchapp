ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS palate_code_version integer NOT NULL DEFAULT -1;

COMMENT ON COLUMN public.profiles.palate_code_version IS
  'palate_version the stored palate_code_red/_white were computed at. Below palate_version means the codes are stale and are recomputed server-side on next read or rating.';