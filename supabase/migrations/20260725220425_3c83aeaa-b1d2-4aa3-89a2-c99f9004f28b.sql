ALTER TABLE public.restaurant_wines
  ADD COLUMN IF NOT EXISTS format text NOT NULL DEFAULT 'bottle'
  CHECK (format IN ('bottle','glass','half'));

ALTER TABLE public.restaurant_wines
  DROP CONSTRAINT IF EXISTS restaurant_wines_restaurant_id_bottle_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS restaurant_wines_rest_bottle_format_uidx
  ON public.restaurant_wines (restaurant_id, bottle_id, format);