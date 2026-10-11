CREATE TABLE IF NOT EXISTS public.offline_sale_sync (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  request_items JSONB NOT NULL,
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.offline_sale_sync ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.offline_sale_sync FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.offline_sale_sync TO service_role;

CREATE OR REPLACE FUNCTION public.sync_admin_offline_sale(
  p_id UUID,
  p_items JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_id_value UUID := auth.uid();
  existing_row public.offline_sale_sync%ROWTYPE;
  requested_item JSONB;
  product_row RECORD;
  variant_price NUMERIC;
  variant_recipes JSONB;
  expected_recipe JSONB;
  actual_recipe JSONB;
  expected_price NUMERIC;
  variant_id_value UUID;
  result_value JSONB;
  receipt_value TEXT;
BEGIN
  IF user_id_value IS NULL OR NOT public.has_role(user_id_value, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Admin authorization required for offline sale synchronization';
  END IF;
  IF p_id IS NULL OR jsonb_typeof(p_items) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_items) = 0 OR jsonb_array_length(p_items) > 100 THEN
    RAISE EXCEPTION 'Invalid offline sale payload';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_id::TEXT, 0));
  SELECT * INTO existing_row FROM public.offline_sale_sync WHERE id = p_id;
  IF FOUND THEN
    IF existing_row.user_id <> user_id_value OR existing_row.request_items <> p_items THEN
      RAISE EXCEPTION 'Offline sale id was already used with different sale data';
    END IF;
    RETURN existing_row.result;
  END IF;

  FOR requested_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    IF jsonb_typeof(requested_item) <> 'object'
       OR COALESCE(requested_item->>'product_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       OR jsonb_typeof(requested_item->'expected_unit_price') IS DISTINCT FROM 'number'
       OR jsonb_typeof(requested_item->'expected_recipe') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Invalid offline sale item';
    END IF;

    SELECT product.id, product.price, category.category_type
    INTO product_row
    FROM public.products AS product
    LEFT JOIN public.categories AS category ON category.id = product.category_id
    WHERE product.id = (requested_item->>'product_id')::UUID
    FOR SHARE OF product;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Product is unavailable';
    END IF;

    expected_price := (requested_item->>'expected_unit_price')::NUMERIC;
    variant_id_value := NULL;
    IF requested_item ? 'variant_id' AND requested_item->>'variant_id' IS NOT NULL THEN
      IF requested_item->>'variant_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RAISE EXCEPTION 'Invalid product variant';
      END IF;
      variant_id_value := (requested_item->>'variant_id')::UUID;
      SELECT variant.price, variant.recipes
      INTO variant_price, variant_recipes
      FROM public.product_variants AS variant
      WHERE variant.id = variant_id_value
        AND variant.product_id = product_row.id
      FOR SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Selected product variant is unavailable';
      END IF;
      IF expected_price IS DISTINCT FROM variant_price THEN
        RAISE EXCEPTION 'Offline sale price changed';
      END IF;
    ELSIF expected_price IS DISTINCT FROM product_row.price THEN
      RAISE EXCEPTION 'Offline sale price changed';
    END IF;

    IF product_row.category_type = 'recipe_based' THEN
      IF variant_id_value IS NULL THEN
        PERFORM 1
        FROM public.product_recipes
        WHERE product_id = product_row.id
        FOR SHARE;
        SELECT COALESCE(
          jsonb_agg(jsonb_build_object(
            'item_id', recipe.item_id,
            'quantity_required', recipe.quantity_required
          ) ORDER BY recipe.item_id),
          '[]'::JSONB
        )
        INTO actual_recipe
        FROM public.product_recipes AS recipe
        WHERE recipe.product_id = product_row.id;
      ELSE
        SELECT COALESCE(
          jsonb_agg(jsonb_build_object(
            'item_id', COALESCE(recipe.value->>'item_id', recipe.value->>'ingredient_id'),
            'quantity_required', COALESCE(
              recipe.value->>'quantity_required',
              recipe.value->>'quantity'
            )::NUMERIC
          ) ORDER BY COALESCE(recipe.value->>'item_id', recipe.value->>'ingredient_id')),
          '[]'::JSONB
        )
        INTO actual_recipe
        FROM jsonb_array_elements(COALESCE(variant_recipes, '[]'::JSONB)) AS recipe(value);
      END IF;

      SELECT COALESCE(
        jsonb_agg(jsonb_build_object(
          'item_id', COALESCE(recipe.value->>'item_id', recipe.value->>'ingredient_id'),
          'quantity_required', COALESCE(
            recipe.value->>'quantity_required',
            recipe.value->>'quantity'
          )::NUMERIC
        ) ORDER BY COALESCE(recipe.value->>'item_id', recipe.value->>'ingredient_id')),
        '[]'::JSONB
      )
      INTO expected_recipe
      FROM jsonb_array_elements(requested_item->'expected_recipe') AS recipe(value);

      IF expected_recipe IS DISTINCT FROM actual_recipe THEN
        RAISE EXCEPTION 'Offline sale recipe changed';
      END IF;
    END IF;
  END LOOP;

  receipt_value := 'CZ-OFF-' || replace(p_id::TEXT, '-', '');
  SELECT public.process_sale_checkout(
    user_id_value,
    receipt_value,
    p_items,
    NULL
  ) INTO result_value;

  INSERT INTO public.offline_sale_sync (id, user_id, request_items, result)
  VALUES (p_id, user_id_value, p_items, result_value);
  RETURN result_value;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_admin_offline_sale(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_admin_offline_sale(UUID, JSONB) TO authenticated;

NOTIFY pgrst, 'reload schema';
