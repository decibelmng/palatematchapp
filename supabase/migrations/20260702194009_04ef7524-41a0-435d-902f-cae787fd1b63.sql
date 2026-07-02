
CREATE TABLE public.scans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'processing',
  page_count INT NOT NULL DEFAULT 0,
  batch_count INT NOT NULL DEFAULT 0,
  batches_done INT NOT NULL DEFAULT 0,
  batches_failed JSONB NOT NULL DEFAULT '[]'::jsonb,
  image_paths JSONB NOT NULL DEFAULT '[]'::jsonb,
  restaurant_id UUID NULL REFERENCES public.restaurants(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scans TO authenticated;
GRANT ALL ON public.scans TO service_role;
ALTER TABLE public.scans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own scans" ON public.scans FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX scans_user_created_idx ON public.scans (user_id, created_at DESC);
CREATE TRIGGER touch_scans BEFORE UPDATE ON public.scans
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.scan_wines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id UUID NOT NULL REFERENCES public.scans(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  batch_index INT NOT NULL DEFAULT 0,
  producer TEXT NULL,
  cuvee TEXT NULL,
  vintage INT NULL,
  wine_type TEXT NULL,
  region TEXT NULL,
  grape TEXT NULL,
  price TEXT NULL,
  raw_json JSONB NULL,
  fp JSONB NULL,
  fp_source TEXT NULL,
  matched_bottle_id UUID NULL,
  match_score REAL NULL,
  match_reasons JSONB NULL,
  predicted_stars REAL NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scan_wines TO authenticated;
GRANT ALL ON public.scan_wines TO service_role;
ALTER TABLE public.scan_wines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own scan_wines" ON public.scan_wines FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX scan_wines_scan_idx ON public.scan_wines (scan_id);
