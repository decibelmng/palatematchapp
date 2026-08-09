CREATE TABLE public.catalog_source_notes (
  bottle_id uuid PRIMARY KEY REFERENCES public.bottles(id) ON DELETE CASCADE,
  source text NOT NULL DEFAULT 'winemag_130k_v2',
  note text NOT NULL,
  points integer,
  source_price numeric,
  source_variety text,
  source_designation text,
  source_province text,
  source_region text,
  join_key text NOT NULL,
  join_method text NOT NULL,
  ambiguous boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX catalog_source_notes_source_idx ON public.catalog_source_notes(source);

GRANT ALL ON public.catalog_source_notes TO service_role;

ALTER TABLE public.catalog_source_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read source notes"
  ON public.catalog_source_notes FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

GRANT SELECT ON public.catalog_source_notes TO authenticated;

COMMENT ON TABLE public.catalog_source_notes IS 'Recovered per-wine human tasting notes (Wine Enthusiast / Kaggle winemag-data-130k-v2), joined to bottles on the verbatim review title. Staging input for the v3 blind re-fingerprint. Facts only — never a score.';