ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS theme text;
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_theme_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_theme_check CHECK (theme IS NULL OR theme IN ('light','dark'));