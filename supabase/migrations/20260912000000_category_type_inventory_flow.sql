ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS category_type TEXT NOT NULL DEFAULT 'Finished Good'
  CHECK (category_type IN ('Finished Good', 'recipe_based'));

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS initial_stock INTEGER NOT NULL DEFAULT 0
  CHECK (initial_stock >= 0),
  ADD COLUMN IF NOT EXISTS total_used INTEGER NOT NULL DEFAULT 0
  CHECK (total_used >= 0);

UPDATE public.products AS product
SET initial_stock = COALESCE(product.initial_stock, product.stock_quantity),
    total_used = 0
WHERE product.initial_stock IS NULL OR product.total_used IS NULL;

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
GRANT SELECT, UPDATE ON public.products TO authenticated;
GRANT ALL ON public.categories TO service_role;
GRANT ALL ON public.products TO service_role;
