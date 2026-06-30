
ALTER TABLE public.bottles ADD COLUMN IF NOT EXISTS type text;

-- Backfill in order of priority. Later updates only run on rows still NULL.

-- Sparkling
UPDATE public.bottles SET type = 'sparkling'
WHERE type IS NULL AND (
  lower(coalesce(grape,'') || ' ' || coalesce(region,'') || ' ' || coalesce(name,''))
  ~ '(sparkling|champagne|prosecco|cava|glera|spumante|cremant|crémant|franciacorta|sekt|lambrusco)'
);

-- Rosé
UPDATE public.bottles SET type = 'rose'
WHERE type IS NULL AND (
  lower(coalesce(grape,'') || ' ' || coalesce(region,'') || ' ' || coalesce(name,''))
  ~ '(ros[ée]|rosado|rosato)'
);

-- White grapes (explicit list + heuristic suffixes)
UPDATE public.bottles SET type = 'white'
WHERE type IS NULL AND grape IS NOT NULL AND (
  lower(grape) IN (
    'chardonnay','riesling','sauvignon blanc','pinot gris','pinot grigio',
    'gewürztraminer','gewurztraminer','white blend','viognier','grüner veltliner',
    'gruner veltliner','chenin blanc','albariño','albarino','moscato','muscat',
    'sémillon','semillon','verdejo','vermentino','garganega','fiano','greco',
    'torrontés','torrontes','marsanne','roussanne','pinot blanc','grillo',
    'cortese','verdicchio','trebbiano','assyrtiko','furmint','melon'
  )
  OR lower(grape) ~ '(blanc|gris|grigio|riesling|white)'
);

-- Everything else = red
UPDATE public.bottles SET type = 'red' WHERE type IS NULL;

ALTER TABLE public.bottles ALTER COLUMN type SET DEFAULT 'red';
ALTER TABLE public.bottles ALTER COLUMN type SET NOT NULL;

CREATE INDEX IF NOT EXISTS bottles_type_idx ON public.bottles(type);
