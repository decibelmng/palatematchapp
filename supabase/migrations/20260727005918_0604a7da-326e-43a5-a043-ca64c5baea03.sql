ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS quiz_answers JSONB,
  ADD COLUMN IF NOT EXISTS quiz_completed_at TIMESTAMPTZ;

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_onboarding_stage_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_onboarding_stage_check
  CHECK (onboarding_stage IN ('intro','quiz','rate5','done'));