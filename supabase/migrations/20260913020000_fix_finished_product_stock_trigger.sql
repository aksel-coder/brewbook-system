-- Restore Finished Product checkout to the original stock model.
-- The live products table uses stock_quantity and does not have initial_stock.
-- This replaces only the existing sale-item trigger function; no data is changed.

CREATE OR REPLACE FUNCTION public.handle_sale_item()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.products
  SET stock_quantity = stock_quantity - NEW.quantity,
      updated_at = now()
  WHERE id = NEW.product_id;

  INSERT INTO public.inventory_transactions(product_id, transaction_type, quantity, reference, created_by)
  VALUES (NEW.product_id, 'sale', -NEW.quantity, NEW.sale_id::text, auth.uid());

  RETURN NEW;
END;
$$;