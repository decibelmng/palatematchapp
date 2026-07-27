-- 1. scans: add kind + label paths (additive; existing rows default to 'list')
ALTER TABLE public.scans
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'list'
    CHECK (kind IN ('list','bottle')),
  ADD COLUMN IF NOT EXISTS front_image_path text,
  ADD COLUMN IF NOT EXISTS back_image_path text;

CREATE INDEX IF NOT EXISTS scans_user_kind_idx ON public.scans(user_id, kind, scanned_at DESC);

-- 2. scan_wines: raw OCR + rating link
ALTER TABLE public.scan_wines
  ADD COLUMN IF NOT EXISTS raw_ocr_text text,
  ADD COLUMN IF NOT EXISTS rated_at timestamptz,
  ADD COLUMN IF NOT EXISTS user_rated_stars int
    CHECK (user_rated_stars IS NULL OR (user_rated_stars BETWEEN 1 AND 5));

-- 3. scan_wine_corrections: append-only OCR correction log
CREATE TABLE IF NOT EXISTS public.scan_wine_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_wine_id uuid NOT NULL REFERENCES public.scan_wines(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  field text NOT NULL CHECK (field IN ('producer','cuvee','vintage','wine_type','region','grape')),
  old_value text,
  new_value text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.scan_wine_corrections TO authenticated;
GRANT ALL ON public.scan_wine_corrections TO service_role;

ALTER TABLE public.scan_wine_corrections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own corrections read"
  ON public.scan_wine_corrections FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "own corrections insert"
  ON public.scan_wine_corrections FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.scan_wine_corrections_reject_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'scan_wine_corrections is append-only: % forbidden', TG_OP;
END $$;

CREATE TRIGGER scan_wine_corrections_no_update
  BEFORE UPDATE ON public.scan_wine_corrections
  FOR EACH ROW EXECUTE FUNCTION public.scan_wine_corrections_reject_mutation();

CREATE TRIGGER scan_wine_corrections_no_delete
  BEFORE DELETE ON public.scan_wine_corrections
  FOR EACH ROW EXECUTE FUNCTION public.scan_wine_corrections_reject_mutation();

CREATE INDEX IF NOT EXISTS scan_wine_corrections_user_idx
  ON public.scan_wine_corrections(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS scan_wine_corrections_wine_idx
  ON public.scan_wine_corrections(scan_wine_id);

-- 4. rating_share_optout: per-rating "don't share this one"
CREATE TABLE IF NOT EXISTS public.rating_share_optout (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rating_id uuid NOT NULL REFERENCES public.ratings(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, rating_id)
);

GRANT SELECT, INSERT, DELETE ON public.rating_share_optout TO authenticated;
GRANT ALL ON public.rating_share_optout TO service_role;

ALTER TABLE public.rating_share_optout ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own optout"
  ON public.rating_share_optout FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- 5. founder_accounts: opt-in surfaced accounts (empty by default)
CREATE TABLE IF NOT EXISTS public.founder_accounts (
  id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  tagline text,
  added_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.founder_accounts TO anon, authenticated;
GRANT ALL ON public.founder_accounts TO service_role;

ALTER TABLE public.founder_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "founder read all"
  ON public.founder_accounts FOR SELECT
  TO anon, authenticated
  USING (true);
