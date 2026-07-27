
-- Helper: verified same-establishment sommelier gate
CREATE OR REPLACE FUNCTION public.is_same_establishment_verified_somm(_user_id uuid, _establishment text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = _user_id
      AND p.somm_status = 'verified'
      AND p.establishment IS NOT NULL
      AND lower(trim(p.establishment)) = lower(trim(_establishment))
  )
$$;

-- House lists (one per establishment)
CREATE TABLE public.house_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  establishment text NOT NULL,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  active_version_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (establishment)
);

CREATE TABLE public.house_list_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  house_list_id uuid NOT NULL REFERENCES public.house_lists(id) ON DELETE CASCADE,
  version int NOT NULL,
  scan_id uuid REFERENCES public.scans(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  UNIQUE (house_list_id, version)
);

CREATE TABLE public.house_list_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id uuid NOT NULL REFERENCES public.house_list_versions(id) ON DELETE CASCADE,
  bottle_id uuid REFERENCES public.bottles(id),
  raw_producer text,
  raw_cuvee text,
  raw_vintage int,
  price_amount numeric,
  currency text,
  format text NOT NULL DEFAULT 'bottle',
  corrected boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.house_list_stock (
  house_list_id uuid NOT NULL REFERENCES public.house_lists(id) ON DELETE CASCADE,
  bottle_id uuid NOT NULL,
  out_of_stock boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES auth.users(id),
  PRIMARY KEY (house_list_id, bottle_id)
);

-- Indexes for typical reads
CREATE INDEX idx_house_list_versions_list ON public.house_list_versions(house_list_id, version DESC);
CREATE INDEX idx_house_list_items_version ON public.house_list_items(version_id);
CREATE INDEX idx_house_list_stock_list ON public.house_list_stock(house_list_id) WHERE out_of_stock = true;

-- Grants (auth-only across the board)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.house_lists TO authenticated;
GRANT ALL ON public.house_lists TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.house_list_versions TO authenticated;
GRANT ALL ON public.house_list_versions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.house_list_items TO authenticated;
GRANT ALL ON public.house_list_items TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.house_list_stock TO authenticated;
GRANT ALL ON public.house_list_stock TO service_role;

-- RLS
ALTER TABLE public.house_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.house_list_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.house_list_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.house_list_stock ENABLE ROW LEVEL SECURITY;

-- Owner or verified same-establishment somm
CREATE POLICY "house_lists_rw"
  ON public.house_lists FOR ALL TO authenticated
  USING (
    owner_id = auth.uid()
    OR public.is_same_establishment_verified_somm(auth.uid(), establishment)
  )
  WITH CHECK (
    owner_id = auth.uid()
    OR public.is_same_establishment_verified_somm(auth.uid(), establishment)
  );

CREATE POLICY "house_list_versions_rw"
  ON public.house_list_versions FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.house_lists hl
      WHERE hl.id = house_list_versions.house_list_id
        AND (hl.owner_id = auth.uid()
             OR public.is_same_establishment_verified_somm(auth.uid(), hl.establishment))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.house_lists hl
      WHERE hl.id = house_list_versions.house_list_id
        AND (hl.owner_id = auth.uid()
             OR public.is_same_establishment_verified_somm(auth.uid(), hl.establishment))
    )
  );

CREATE POLICY "house_list_items_rw"
  ON public.house_list_items FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.house_list_versions v
      JOIN public.house_lists hl ON hl.id = v.house_list_id
      WHERE v.id = house_list_items.version_id
        AND (hl.owner_id = auth.uid()
             OR public.is_same_establishment_verified_somm(auth.uid(), hl.establishment))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.house_list_versions v
      JOIN public.house_lists hl ON hl.id = v.house_list_id
      WHERE v.id = house_list_items.version_id
        AND (hl.owner_id = auth.uid()
             OR public.is_same_establishment_verified_somm(auth.uid(), hl.establishment))
    )
  );

CREATE POLICY "house_list_stock_rw"
  ON public.house_list_stock FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.house_lists hl
      WHERE hl.id = house_list_stock.house_list_id
        AND (hl.owner_id = auth.uid()
             OR public.is_same_establishment_verified_somm(auth.uid(), hl.establishment))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.house_lists hl
      WHERE hl.id = house_list_stock.house_list_id
        AND (hl.owner_id = auth.uid()
             OR public.is_same_establishment_verified_somm(auth.uid(), hl.establishment))
    )
  );

-- FK for active_version_id, deferred until versions table exists
ALTER TABLE public.house_lists
  ADD CONSTRAINT house_lists_active_version_fk
  FOREIGN KEY (active_version_id) REFERENCES public.house_list_versions(id) ON DELETE SET NULL;

-- updated_at trigger for house_lists
CREATE OR REPLACE FUNCTION public.house_lists_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER house_lists_touch_trg
  BEFORE UPDATE ON public.house_lists
  FOR EACH ROW EXECUTE FUNCTION public.house_lists_touch();
