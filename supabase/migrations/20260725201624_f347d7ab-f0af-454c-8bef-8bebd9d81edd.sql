CREATE TABLE IF NOT EXISTS public.admin_type_review_rejects (
  bottle_id uuid PRIMARY KEY REFERENCES public.bottles(id) ON DELETE CASCADE,
  rejected_by uuid,
  rejected_at timestamptz NOT NULL DEFAULT now(),
  note text
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.admin_type_review_rejects TO authenticated;
GRANT ALL ON public.admin_type_review_rejects TO service_role;

ALTER TABLE public.admin_type_review_rejects ENABLE ROW LEVEL SECURITY;

-- No policies: only server-side admin code (via service role) reads/writes.
