ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS reservation_id UUID
  REFERENCES public.reservations(id) ON DELETE RESTRICT;

ALTER TABLE public.sale_items
  ADD COLUMN IF NOT EXISTS product_variant_id UUID
  REFERENCES public.product_variants(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS variant_name TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS sales_reservation_id_unique
  ON public.sales (reservation_id)
  WHERE reservation_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.handle_sale_item()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  receipt_code TEXT;
  sale_user_id UUID;
  inventory_type TEXT;
BEGIN
  SELECT receipt_number, user_id
  INTO receipt_code, sale_user_id
  FROM public.sales
  WHERE id = NEW.sale_id;

  SELECT category.category_type
  INTO inventory_type
  FROM public.products AS product
  LEFT JOIN public.categories AS category ON category.id = product.category_id
  WHERE product.id = NEW.product_id;

  IF COALESCE(inventory_type, 'Finished Good') <> 'recipe_based' THEN
    UPDATE public.products
    SET stock_quantity = stock_quantity - NEW.quantity,
        total_used = COALESCE(total_used, 0) + NEW.quantity,
        updated_at = now()
    WHERE id = NEW.product_id
      AND stock_quantity >= NEW.quantity;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Insufficient product stock';
    END IF;
    INSERT INTO public.inventory_transactions(product_id, transaction_type, quantity, reference, created_by)
    VALUES (
      NEW.product_id,
      'sale',
      -NEW.quantity,
      COALESCE(receipt_code, NEW.sale_id::text),
      COALESCE(sale_user_id, auth.uid())
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.process_sale_checkout(
  p_user_id UUID,
  p_receipt_number TEXT,
  p_items JSONB,
  p_reservation_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  reservation_row public.reservations%ROWTYPE;
  sale_row public.sales%ROWTYPE;
  requested_item JSONB;
  recipe_item JSONB;
  inventory_row RECORD;
  product_row RECORD;
  variant_row RECORD;
  product_id_value UUID;
  variant_id_value UUID;
  recipe_item_id UUID;
  quantity_value INTEGER;
  required_quantity NUMERIC;
  item_price NUMERIC(10, 2);
  line_total NUMERIC(10, 2);
  sale_subtotal NUMERIC(10, 2) := 0;
  finished_demand JSONB := '{}'::JSONB;
  ingredient_demand JSONB := '{}'::JSONB;
  item_lines JSONB := '[]'::JSONB;
  item_recipes JSONB;
  reservation_items_count INTEGER := 0;
  receipt_value TEXT;
  recipe_based BOOLEAN;
  product_name_value TEXT;
  variant_name_value TEXT;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Sale operator is required';
  END IF;

  IF p_reservation_id IS NULL THEN
    IF auth.uid() IS DISTINCT FROM p_user_id
       AND COALESCE(auth.role(), '') <> 'service_role' THEN
      RAISE EXCEPTION 'Sale operator does not match the authenticated user';
    END IF;
    IF NOT (
      public.has_role(p_user_id, 'admin'::public.app_role)
      OR public.has_role(p_user_id, 'cashier'::public.app_role)
    ) THEN
      RAISE EXCEPTION 'Sale operator is not authorized';
    END IF;
    IF p_receipt_number IS NULL OR length(trim(p_receipt_number)) = 0
       OR p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
      RAISE EXCEPTION 'Invalid checkout payload';
    END IF;
    IF jsonb_array_length(p_items) = 0 OR jsonb_array_length(p_items) > 100 THEN
      RAISE EXCEPTION 'Invalid checkout payload';
    END IF;
    receipt_value := trim(p_receipt_number);
  ELSE
    SELECT *
    INTO reservation_row
    FROM public.reservations
    WHERE id = p_reservation_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Reservation not found';
    END IF;
    IF auth.uid() IS DISTINCT FROM p_user_id
       AND COALESCE(auth.role(), '') <> 'service_role' THEN
      RAISE EXCEPTION 'Reservation access denied';
    END IF;
    IF NOT (
      public.has_role(p_user_id, 'admin'::public.app_role)
      OR (
        public.has_role(p_user_id, 'cashier'::public.app_role)
        AND EXISTS (
          SELECT 1
          FROM public.reservation_staff_access
          WHERE user_id = p_user_id
        )
      )
    ) THEN
      RAISE EXCEPTION 'Reservation access denied';
    END IF;

    IF reservation_row.status = 'Completed' THEN
      SELECT *
      INTO sale_row
      FROM public.sales
      WHERE reservation_id = p_reservation_id;
      IF FOUND THEN
        RETURN jsonb_build_object(
          'sale', to_jsonb(sale_row),
          'items', '[]'::JSONB,
          'subtotal', sale_row.subtotal,
          'tax', sale_row.tax,
          'total', sale_row.total_amount
        );
      END IF;
      RAISE EXCEPTION 'Completed reservation is missing its sale';
    END IF;
    IF reservation_row.status <> 'Ready for Pickup' THEN
      RAISE EXCEPTION 'Reservation must be ready for pickup before completion';
    END IF;

    receipt_value := 'CZ-' || reservation_row.reservation_number;
    SELECT count(*)::INTEGER
    INTO reservation_items_count
    FROM public.reservation_items
    WHERE reservation_id = p_reservation_id;
    IF reservation_items_count = 0 THEN
      RAISE EXCEPTION 'Reservation has no items';
    END IF;
  END IF;

  IF p_reservation_id IS NULL THEN
    FOR requested_item IN SELECT value FROM jsonb_array_elements(p_items)
    LOOP
      IF jsonb_typeof(requested_item) <> 'object'
         OR COALESCE(requested_item->>'product_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         OR COALESCE(requested_item->>'quantity', '') !~ '^[1-9][0-9]*$'
         OR length(requested_item->>'quantity') > 9 THEN
        RAISE EXCEPTION 'Invalid sale item';
      END IF;
      product_id_value := (requested_item->>'product_id')::UUID;
      quantity_value := (requested_item->>'quantity')::INTEGER;
      variant_id_value := NULL;
      IF requested_item ? 'variant_id' AND requested_item->>'variant_id' IS NOT NULL THEN
        IF requested_item->>'variant_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
          RAISE EXCEPTION 'Invalid product variant';
        END IF;
        variant_id_value := (requested_item->>'variant_id')::UUID;
      END IF;
      SELECT product.id, product.name, product.price, product.is_active,
             category.category_type
      INTO product_row
      FROM public.products AS product
      LEFT JOIN public.categories AS category ON category.id = product.category_id
      WHERE product.id = product_id_value;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Product is unavailable';
      END IF;
      IF NOT product_row.is_active THEN
        RAISE EXCEPTION 'Product is unavailable';
      END IF;

      product_name_value := product_row.name;
      variant_name_value := NULL;
      item_price := product_row.price;
      item_recipes := '[]'::JSONB;
      IF variant_id_value IS NOT NULL THEN
        SELECT id, product_id, name, price, recipes
        INTO variant_row
        FROM public.product_variants
        WHERE id = variant_id_value
          AND product_id = product_id_value;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Selected product variant is unavailable';
        END IF;
        item_price := variant_row.price;
        variant_name_value := variant_row.name;
        item_recipes := COALESCE(variant_row.recipes, '[]'::JSONB);
      ELSE
        SELECT COALESCE(
          jsonb_agg(jsonb_build_object(
            'item_id', item_id,
            'quantity_required', quantity_required
          )),
          '[]'::JSONB
        )
        INTO item_recipes
        FROM public.product_recipes
        WHERE product_id = product_id_value;
      END IF;

      recipe_based := product_row.category_type = 'recipe_based';
      IF recipe_based THEN
        IF item_recipes IS NULL OR jsonb_typeof(item_recipes) <> 'array' THEN
          RAISE EXCEPTION 'Recipe-based product has no recipe';
        END IF;
        IF jsonb_array_length(item_recipes) = 0 THEN
          RAISE EXCEPTION 'Recipe-based product has no recipe';
        END IF;
        FOR recipe_item IN SELECT value FROM jsonb_array_elements(item_recipes)
        LOOP
          IF COALESCE(recipe_item->>'item_id', recipe_item->>'ingredient_id', '')
               !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
             OR COALESCE(recipe_item->>'quantity_required', recipe_item->>'quantity', '')
               !~ '^[0-9]+([.][0-9]+)?$' THEN
            RAISE EXCEPTION 'Recipe contains an invalid ingredient';
          END IF;
          recipe_item_id := COALESCE(
            recipe_item->>'item_id',
            recipe_item->>'ingredient_id'
          )::UUID;
          required_quantity := COALESCE(
            recipe_item->>'quantity_required',
            recipe_item->>'quantity'
          )::NUMERIC * quantity_value;
          IF required_quantity <= 0 THEN
            RAISE EXCEPTION 'Recipe contains an invalid ingredient quantity';
          END IF;
          ingredient_demand := jsonb_set(
            ingredient_demand,
            ARRAY[recipe_item_id::TEXT],
            to_jsonb(
              COALESCE((ingredient_demand->>recipe_item_id::TEXT)::NUMERIC, 0)
              + required_quantity
            ),
            true
          );
        END LOOP;
      ELSE
        finished_demand := jsonb_set(
          finished_demand,
          ARRAY[product_id_value::TEXT],
          to_jsonb(
            COALESCE((finished_demand->>product_id_value::TEXT)::NUMERIC, 0)
            + quantity_value
          ),
          true
        );
      END IF;

      line_total := item_price * quantity_value;
      sale_subtotal := sale_subtotal + line_total;
      item_lines := item_lines || jsonb_build_array(jsonb_build_object(
        'product_id', product_id_value,
        'variant_id', variant_id_value,
        'product_name', product_name_value,
        'variant_name', variant_name_value,
        'quantity', quantity_value,
        'unit_price', item_price,
        'subtotal', line_total
      ));
    END LOOP;
  ELSE
    FOR requested_item IN
      SELECT to_jsonb(reservation_item)
      FROM public.reservation_items AS reservation_item
      WHERE reservation_item.reservation_id = p_reservation_id
      ORDER BY reservation_item.created_at, reservation_item.id
    LOOP
      product_id_value := (requested_item->>'product_id')::UUID;
      IF product_id_value IS NULL THEN
        RAISE EXCEPTION 'A reserved product is no longer available';
      END IF;
      quantity_value := (requested_item->>'quantity')::INTEGER;
      variant_id_value := NULLIF(requested_item->>'product_variant_id', '')::UUID;
      item_price := (requested_item->>'unit_price')::NUMERIC;
      line_total := item_price * quantity_value;

      SELECT product.id, product.name, product.price, product.is_active,
             category.category_type
      INTO product_row
      FROM public.products AS product
      LEFT JOIN public.categories AS category ON category.id = product.category_id
      WHERE product.id = product_id_value;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'A reserved product is no longer available';
      END IF;

      product_name_value := COALESCE(requested_item->>'product_name', product_row.name);
      variant_name_value := requested_item->>'variant_name';
      item_recipes := '[]'::JSONB;
      IF variant_id_value IS NOT NULL THEN
        SELECT id, product_id, name, recipes
        INTO variant_row
        FROM public.product_variants
        WHERE id = variant_id_value
          AND product_id = product_id_value;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'A reserved product variant is no longer available';
        END IF;
        item_recipes := COALESCE(variant_row.recipes, '[]'::JSONB);
      ELSE
        SELECT COALESCE(
          jsonb_agg(jsonb_build_object(
            'item_id', item_id,
            'quantity_required', quantity_required
          )),
          '[]'::JSONB
        )
        INTO item_recipes
        FROM public.product_recipes
        WHERE product_id = product_id_value;
      END IF;

      recipe_based := product_row.category_type = 'recipe_based';
      IF recipe_based THEN
        IF item_recipes IS NULL OR jsonb_typeof(item_recipes) <> 'array' THEN
          RAISE EXCEPTION 'Recipe-based product has no recipe';
        END IF;
        IF jsonb_array_length(item_recipes) = 0 THEN
          RAISE EXCEPTION 'Recipe-based product has no recipe';
        END IF;
        FOR recipe_item IN SELECT value FROM jsonb_array_elements(item_recipes)
        LOOP
          IF COALESCE(recipe_item->>'item_id', recipe_item->>'ingredient_id', '')
               !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
             OR COALESCE(recipe_item->>'quantity_required', recipe_item->>'quantity', '')
               !~ '^[0-9]+([.][0-9]+)?$' THEN
            RAISE EXCEPTION 'Recipe contains an invalid ingredient';
          END IF;
          recipe_item_id := COALESCE(
            recipe_item->>'item_id',
            recipe_item->>'ingredient_id'
          )::UUID;
          required_quantity := COALESCE(
            recipe_item->>'quantity_required',
            recipe_item->>'quantity'
          )::NUMERIC * quantity_value;
          IF required_quantity <= 0 THEN
            RAISE EXCEPTION 'Recipe contains an invalid ingredient quantity';
          END IF;
          ingredient_demand := jsonb_set(
            ingredient_demand,
            ARRAY[recipe_item_id::TEXT],
            to_jsonb(
              COALESCE((ingredient_demand->>recipe_item_id::TEXT)::NUMERIC, 0)
              + required_quantity
            ),
            true
          );
        END LOOP;
      ELSE
        finished_demand := jsonb_set(
          finished_demand,
          ARRAY[product_id_value::TEXT],
          to_jsonb(
            COALESCE((finished_demand->>product_id_value::TEXT)::NUMERIC, 0)
            + quantity_value
          ),
          true
        );
      END IF;

      sale_subtotal := sale_subtotal + line_total;
      item_lines := item_lines || jsonb_build_array(jsonb_build_object(
        'product_id', product_id_value,
        'variant_id', variant_id_value,
        'product_name', product_name_value,
        'variant_name', variant_name_value,
        'quantity', quantity_value,
        'unit_price', item_price,
        'subtotal', line_total
      ));
    END LOOP;
  END IF;

  FOR inventory_row IN
    SELECT key::UUID AS product_id, value::NUMERIC AS required_quantity
    FROM jsonb_each_text(finished_demand)
    ORDER BY key
  LOOP
    PERFORM 1
    FROM public.products
    WHERE id = inventory_row.product_id
    FOR UPDATE;

    IF NOT FOUND OR NOT EXISTS (
      SELECT 1
      FROM public.products
      WHERE id = inventory_row.product_id
        AND stock_quantity >= inventory_row.required_quantity
    ) THEN
      RAISE EXCEPTION 'Insufficient product stock';
    END IF;
  END LOOP;

  FOR inventory_row IN
    SELECT key::UUID AS item_id, value::NUMERIC AS required_quantity
    FROM jsonb_each_text(ingredient_demand)
    ORDER BY key
  LOOP
    PERFORM 1
    FROM public.inventory_items
    WHERE id = inventory_row.item_id
    FOR UPDATE;

    IF NOT FOUND OR NOT EXISTS (
      SELECT 1
      FROM public.inventory_items
      WHERE id = inventory_row.item_id
        AND current_stock >= inventory_row.required_quantity
    ) THEN
      RAISE EXCEPTION 'Insufficient ingredient stock';
    END IF;
  END LOOP;

  IF p_reservation_id IS NOT NULL THEN
    INSERT INTO public.sales (
      receipt_number,
      user_id,
      subtotal,
      tax,
      total_amount,
      reservation_id
    )
    VALUES (
      receipt_value,
      p_user_id,
      sale_subtotal,
      0,
      sale_subtotal,
      p_reservation_id
    )
    RETURNING * INTO sale_row;
  ELSE
    INSERT INTO public.sales (
      receipt_number,
      user_id,
      subtotal,
      tax,
      total_amount
    )
    VALUES (
      receipt_value,
      p_user_id,
      sale_subtotal,
      0,
      sale_subtotal
    )
    RETURNING * INTO sale_row;
  END IF;

  INSERT INTO public.sale_items (
    sale_id,
    product_id,
    product_variant_id,
    variant_name,
    quantity,
    unit_price
  )
  SELECT
    sale_row.id,
    (line->>'product_id')::UUID,
    NULLIF(line->>'variant_id', '')::UUID,
    line->>'variant_name',
    (line->>'quantity')::INTEGER,
    (line->>'unit_price')::NUMERIC
  FROM jsonb_array_elements(item_lines) AS line;

  FOR inventory_row IN
    SELECT key::UUID AS item_id, value::NUMERIC AS required_quantity
    FROM jsonb_each_text(ingredient_demand)
    ORDER BY key
  LOOP
    UPDATE public.inventory_items
    SET current_stock = current_stock - inventory_row.required_quantity,
        total_used = COALESCE(total_used, 0) + inventory_row.required_quantity
    WHERE id = inventory_row.item_id
      AND current_stock >= inventory_row.required_quantity;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Insufficient ingredient stock';
    END IF;

    INSERT INTO public.inventory_movements (item_id, type, qty, reference)
    VALUES (
      inventory_row.item_id,
      'Sale',
      -inventory_row.required_quantity,
      receipt_value
    );
  END LOOP;

  IF p_reservation_id IS NOT NULL THEN
    UPDATE public.reservations
    SET status = 'Completed'
    WHERE id = p_reservation_id
      AND status = 'Ready for Pickup';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Reservation status changed before completion';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'sale', to_jsonb(sale_row),
    'items', item_lines,
    'subtotal', sale_subtotal,
    'tax', 0,
    'total', sale_subtotal
  );
END;
$$;

REVOKE ALL ON FUNCTION public.process_pos_checkout(TEXT, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_pos_checkout(TEXT, JSONB)
  TO service_role;

REVOKE ALL ON FUNCTION public.process_sale_checkout(UUID, TEXT, JSONB, UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.process_sale_checkout(UUID, TEXT, JSONB, UUID)
  TO authenticated, service_role;

REVOKE INSERT ON TABLE public.sales, public.sale_items
  FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';
