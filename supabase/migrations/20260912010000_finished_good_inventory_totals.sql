ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS initial_stock INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_used INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'products_initial_stock_nonnegative'
      AND conrelid = 'public.products'::regclass
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_initial_stock_nonnegative CHECK (initial_stock >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'products_total_used_nonnegative'
      AND conrelid = 'public.products'::regclass
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_total_used_nonnegative CHECK (total_used >= 0);
  END IF;
END $$;

UPDATE public.products AS product
SET initial_stock = GREATEST(product.stock_quantity, 0),
    total_used = GREATEST(-product.stock_quantity, 0)
WHERE product.initial_stock = 0 AND product.total_used = 0;

GRANT SELECT, UPDATE ON public.products TO authenticated;
GRANT ALL ON public.products TO service_role;