-- Keep finished-product stock and movement logging in the sale-item trigger.
-- Recipe products are handled by the recipe branch in the application checkout.
CREATE OR REPLACE FUNCTION public.handle_sale_item()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  receipt_code TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.product_recipes WHERE product_id = NEW.product_id) THEN
    SELECT receipt_number INTO receipt_code
    FROM public.sales
    WHERE id = NEW.sale_id;

    UPDATE public.products
    SET stock_quantity = GREATEST(COALESCE(stock_quantity, 0) - NEW.quantity, 0),
        total_used = COALESCE(total_used, 0) + NEW.quantity,
        updated_at = now()
    WHERE id = NEW.product_id;

    INSERT INTO public.inventory_transactions(product_id, transaction_type, quantity, reference, created_by)
    VALUES (NEW.product_id, 'sale', -NEW.quantity, COALESCE(receipt_code, NEW.sale_id::text), auth.uid());
  END IF;

  RETURN NEW;
END;
$$;