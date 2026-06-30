
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- BOTTLES
CREATE TABLE public.bottles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  producer text,
  region text,
  grape text,
  vintage int,
  price_band text,
  fp_fresh real NOT NULL DEFAULT 0.5,
  fp_acid real NOT NULL DEFAULT 0.5,
  fp_tannin real NOT NULL DEFAULT 0.5,
  fp_fruit_dark real NOT NULL DEFAULT 0.5,
  fp_ripe real NOT NULL DEFAULT 0.5,
  fp_oak real NOT NULL DEFAULT 0.5,
  fp_body real NOT NULL DEFAULT 0.5,
  fp_savory real NOT NULL DEFAULT 0.5,
  ax_body real NOT NULL DEFAULT 0.5,
  ax_fruit_char real NOT NULL DEFAULT 0.5,
  ax_tannin real NOT NULL DEFAULT 0.5,
  ax_acidity real NOT NULL DEFAULT 0.5,
  ax_sweet real NOT NULL DEFAULT 0.0,
  critic_score int,
  source text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bottles_name_trgm ON public.bottles USING gin (name gin_trgm_ops);
GRANT SELECT ON public.bottles TO anon, authenticated;
GRANT ALL ON public.bottles TO service_role;
ALTER TABLE public.bottles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Bottles are publicly readable" ON public.bottles FOR SELECT USING (true);

-- PROFILES
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  palate_code text NOT NULL DEFAULT '·····',
  n_rated int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Profiles are publicly readable" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE POLICY "Users insert own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
  RETURN NEW;
END; $$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- RATINGS
CREATE TABLE public.ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  bottle_id uuid NOT NULL REFERENCES public.bottles(id) ON DELETE CASCADE,
  stars int NOT NULL CHECK (stars BETWEEN 1 AND 5),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, bottle_id)
);
CREATE INDEX ratings_user_idx ON public.ratings(user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ratings TO authenticated;
GRANT ALL ON public.ratings TO service_role;
ALTER TABLE public.ratings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own ratings" ON public.ratings FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE TRIGGER ratings_touch BEFORE UPDATE ON public.ratings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER profiles_touch BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
