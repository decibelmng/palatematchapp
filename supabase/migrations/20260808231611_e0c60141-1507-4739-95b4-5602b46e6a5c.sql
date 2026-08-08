UPDATE public.profiles
SET palate_version = palate_version + 1,
    updated_at = now();