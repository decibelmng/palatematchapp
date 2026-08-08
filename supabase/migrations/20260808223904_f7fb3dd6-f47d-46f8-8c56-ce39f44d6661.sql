ALTER TABLE public.call_instrumentation
  ADD COLUMN IF NOT EXISTS n_priced integer NOT NULL DEFAULT 0;

ALTER TABLE public.call_instrumentation
  DROP CONSTRAINT IF EXISTS call_instrumentation_price_position_check;

ALTER TABLE public.call_instrumentation
  ADD CONSTRAINT call_instrumentation_price_position_check
  CHECK (price_position = ANY (ARRAY['bottom-third'::text, 'middle'::text, 'top-third'::text, 'unknown'::text, 'insufficient'::text]));