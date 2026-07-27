-- A3: bump profiles.palate_version whenever quiz_answers changes.
-- BEFORE UPDATE trigger mutates NEW in the same row so it never recurses.
CREATE OR REPLACE FUNCTION public.bump_palate_version_from_quiz()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.quiz_answers IS DISTINCT FROM OLD.quiz_answers THEN
    NEW.palate_version := COALESCE(OLD.palate_version, 0) + 1;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.bump_palate_version_from_quiz() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bump_palate_version_from_quiz() FROM anon;
REVOKE ALL ON FUNCTION public.bump_palate_version_from_quiz() FROM authenticated;

DROP TRIGGER IF EXISTS profiles_bump_palate_version_from_quiz ON public.profiles;
CREATE TRIGGER profiles_bump_palate_version_from_quiz
BEFORE UPDATE OF quiz_answers ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.bump_palate_version_from_quiz();