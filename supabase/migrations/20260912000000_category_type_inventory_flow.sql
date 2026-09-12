ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS category_type TEXT NOT NULL DEFAULT 'Finished Good'
  CHECK (category_type IN ('Finished Good', 'recipe_based'));

UPDATE public.categories
SET category_type = 'Finished Good'
WHERE category_type IS NULL OR category_type NOT IN ('Finished Good', 'recipe_based');

CREATE OR REPLACE FUNCTION public.resolve_category_inventory_type(p_category_type TEXT, p_recipe_count INTEGER)
RETURNS TEXT
LANGUAGE SQL
STABLE
AS $$
  SELECT CASE
    WHEN p_category_type = 'recipe_based' THEN 'recipe_based'
    WHEN p_category_type = 'Finished Good' THEN 'Finished Good'
    WHEN p_recipe_count > 0 THEN 'recipe_based'
    ELSE 'Finished Good'
  END;
$$;

GRANT SELECT, UPDATE ON public.categories TO authenticated;
GRANT ALL ON public.categories TO service_role;
