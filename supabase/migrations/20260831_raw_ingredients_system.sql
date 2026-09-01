-- Raw ingredients inventory and recipe consumption
CREATE TABLE IF NOT EXISTS public.inventory_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  unit VARCHAR(3) NOT NULL CHECK (unit IN ('g', 'ml', 'pcs', 'oz')),
  initial_stock NUMERIC NOT NULL DEFAULT 0 CHECK (initial_stock >= 0),
  total_used NUMERIC NOT NULL DEFAULT 0 CHECK (total_used >= 0),
  current_stock NUMERIC NOT NULL DEFAULT 0 CHECK (current_stock >= 0),
  low_stock_threshold NUMERIC NOT NULL DEFAULT 0 CHECK (low_stock_threshold >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.product_recipes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  quantity_required NUMERIC NOT NULL CHECK (quantity_required > 0),
  UNIQUE(product_id, item_id)
);

CREATE TABLE IF NOT EXISTS public.inventory_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('In', 'Sale', 'Out', 'Waste')),
  qty NUMERIC NOT NULL,
  reference TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.inventory_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_recipes TO authenticated;
GRANT SELECT, INSERT ON public.inventory_movements TO authenticated;
GRANT ALL ON public.inventory_items, public.product_recipes, public.inventory_movements TO service_role;

ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inventory_items_read ON public.inventory_items;
DROP POLICY IF EXISTS inventory_items_admin_write ON public.inventory_items;
CREATE POLICY inventory_items_read ON public.inventory_items FOR SELECT TO authenticated USING (true);
CREATE POLICY inventory_items_admin_write ON public.inventory_items FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS product_recipes_read ON public.product_recipes;
DROP POLICY IF EXISTS product_recipes_admin_write ON public.product_recipes;
CREATE POLICY product_recipes_read ON public.product_recipes FOR SELECT TO authenticated USING (true);
CREATE POLICY product_recipes_admin_write ON public.product_recipes FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS inventory_movements_read ON public.inventory_movements;
DROP POLICY IF EXISTS inventory_movements_admin_write ON public.inventory_movements;
CREATE POLICY inventory_movements_read ON public.inventory_movements FOR SELECT TO authenticated USING (true);
CREATE POLICY inventory_movements_admin_write ON public.inventory_movements FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Recipe-backed products consume raw ingredients; products without recipes use product stock.
CREATE OR REPLACE FUNCTION public.handle_sale_item()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.product_recipes WHERE product_id = NEW.product_id) THEN
    UPDATE public.products
    SET stock_quantity = stock_quantity - NEW.quantity, updated_at = now()
    WHERE id = NEW.product_id;
    INSERT INTO public.inventory_transactions(product_id, transaction_type, quantity, reference, created_by)
    VALUES (NEW.product_id, 'sale', -NEW.quantity, NEW.sale_id::text, auth.uid());
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.process_pos_checkout(p_receipt_id TEXT, p_items JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  item JSONB;
  recipe_row RECORD;
  sold_quantity NUMERIC;
  required_quantity NUMERIC;
  consumed JSONB := '[]'::JSONB;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_receipt_id IS NULL OR length(trim(p_receipt_id)) = 0 OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'Invalid checkout payload';
  END IF;

  FOR recipe_row IN
    SELECT pr.item_id, ii.name, ii.current_stock, ii.total_used,
           SUM(pr.quantity_required * (line.value->>'quantity_sold')::NUMERIC) AS required_quantity
    FROM jsonb_array_elements(p_items) AS line(value)
    JOIN public.product_recipes pr ON pr.product_id = (line.value->>'product_id')::UUID
    JOIN public.inventory_items ii ON ii.id = pr.item_id
    GROUP BY pr.item_id, ii.name, ii.current_stock, ii.total_used
  LOOP
    required_quantity := recipe_row.required_quantity;
    IF recipe_row.current_stock < required_quantity THEN
      RAISE EXCEPTION 'Insufficient ingredient stock for %', recipe_row.name;
    END IF;

    UPDATE public.inventory_items
    SET total_used = total_used + required_quantity,
        current_stock = current_stock - required_quantity
    WHERE id = recipe_row.item_id;

    INSERT INTO public.inventory_movements(item_id, type, qty, reference)
    VALUES (recipe_row.item_id, 'Sale', -required_quantity, p_receipt_id);

    consumed := consumed || jsonb_build_object(
      'item_id', recipe_row.item_id,
      'quantity_used', required_quantity
    );
  END LOOP;

  RETURN jsonb_build_object('receipt_id', p_receipt_id, 'consumed', consumed);
END;
$$;

REVOKE ALL ON FUNCTION public.process_pos_checkout(TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_pos_checkout(TEXT, JSONB) TO authenticated, service_role;
