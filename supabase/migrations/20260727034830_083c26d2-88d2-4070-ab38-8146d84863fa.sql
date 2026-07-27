
-- 1. scans: kind + label paths
ALTER TABLE public.scans
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'list' CHECK (kind IN ('list','bottle')),
  ADD COLUMN IF NOT EXISTS front_image_path TEXT,
  ADD COLUMN IF NOT EXISTS back_image_path TEXT;

-- 2. scan_wines: OCR text + rating trail
ALTER TABLE public.scan_wines
  ADD COLUMN IF NOT EXISTS raw_ocr_text TEXT,
  ADD COLUMN IF NOT EXISTS rated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS user_rated_stars SMALLINT CHECK (user_rated_stars BETWEEN 1 AND 5);

-- 3. scan_wine_corrections (append-only)
CREATE TABLE IF NOT EXISTS public.scan_wine_corrections (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  scan_wine_id UUID NOT NULL REFERENCES public.scan_wines(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  field TEXT NOT NULL CHECK (field IN ('producer','cuvee','vintage','wine_type','region','grape')),
  old_value TEXT,
  new_value TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.scan_wine_corrections TO authenticated;
GRANT ALL ON public.scan_wine_corrections TO service_role;
ALTER TABLE public.scan_wine_corrections ENABLE ROW LEVEL SECURITY;

CREATE POLICY scan_wine_corrections_select_own ON public.scan_wine_corrections
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY scan_wine_corrections_insert_own ON public.scan_wine_corrections
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.scan_wine_corrections_reject_mutation()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'scan_wine_corrections is append-only: % forbidden', TG_OP;
END $$;
DROP TRIGGER IF EXISTS scan_wine_corrections_no_update ON public.scan_wine_corrections;
CREATE TRIGGER scan_wine_corrections_no_update BEFORE UPDATE ON public.scan_wine_corrections
  FOR EACH ROW EXECUTE FUNCTION public.scan_wine_corrections_reject_mutation();
DROP TRIGGER IF EXISTS scan_wine_corrections_no_delete ON public.scan_wine_corrections;
CREATE TRIGGER scan_wine_corrections_no_delete BEFORE DELETE ON public.scan_wine_corrections
  FOR EACH ROW EXECUTE FUNCTION public.scan_wine_corrections_reject_mutation();

CREATE INDEX IF NOT EXISTS scan_wine_corrections_scan_wine_id_idx
  ON public.scan_wine_corrections(scan_wine_id);

-- 4. rating_share_optout
CREATE TABLE IF NOT EXISTS public.rating_share_optout (
  user_id UUID NOT NULL,
  rating_id UUID NOT NULL REFERENCES public.ratings(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, rating_id)
);
GRANT SELECT, INSERT, DELETE ON public.rating_share_optout TO authenticated;
GRANT ALL ON public.rating_share_optout TO service_role;
ALTER TABLE public.rating_share_optout ENABLE ROW LEVEL SECURITY;

CREATE POLICY rating_share_optout_select_own ON public.rating_share_optout
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY rating_share_optout_insert_own ON public.rating_share_optout
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY rating_share_optout_delete_own ON public.rating_share_optout
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS rating_share_optout_rating_id_idx
  ON public.rating_share_optout(rating_id);

-- 5. founder_accounts (public read; writes = service_role only)
CREATE TABLE IF NOT EXISTS public.founder_accounts (
  id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  tagline TEXT,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.founder_accounts TO anon, authenticated;
GRANT ALL ON public.founder_accounts TO service_role;
ALTER TABLE public.founder_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY founder_accounts_read_all ON public.founder_accounts
  FOR SELECT TO anon, authenticated USING (true);
