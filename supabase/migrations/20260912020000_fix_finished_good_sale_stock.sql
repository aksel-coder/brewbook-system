-- Fix Finished Good sale behavior so Initial Stock remains constant and sales only increase Used.
-- This prevents the trigger from reducing initial_stock during POS checkout.

CREATE OR REPLACE FUNCTION public.handle_sale_item()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.product_recipes WHERE product_id = NEW.product_id) THEN
    UPDATE public.products
    SET
      total_used = COALESCE(total_used, 0) + NEW.quantity,
      stock_quantity = GREATEST(COALESCE(initial_stock, stock_quantity) - (COALESCE(total_used, 0) + NEW.quantity), 0),
      updated_at = now()
    WHERE id = NEW.product_id;

    INSERT INTO public.inventory_transactions(product_id, transaction_type, quantity, reference, created_by)
    VALUES (NEW.product_id, 'sale', -NEW.quantity, NEW.sale_id::text, auth.uid());
  END IF;

  RETURN NEW;
END;
$$;

-- If a product has no initial_stock yet, seed it from current stock_quantity without changing current stock values.
UPDATE public.products
SET initial_stock = COALESCE(initial_stock, stock_quantity)
WHERE initial_stock IS NULL;

GRANT SELECT, UPDATE ON public.products TO authenticated;
GRANT ALL ON public.products TO service_role;
