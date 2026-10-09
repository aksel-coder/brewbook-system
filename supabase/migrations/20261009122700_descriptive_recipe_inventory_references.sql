-- Record per-product recipe consumption details while keeping stock deductions aggregated.
BEGIN;

DO $$
DECLARE
  function_ddl TEXT;
  old_movement_insert TEXT;
  new_movement_insert TEXT;
BEGIN
  SELECT pg_get_functiondef(
    'public.process_sale_checkout(uuid,text,jsonb,uuid)'::regprocedure
  )
  INTO function_ddl;

  IF function_ddl IS NULL THEN
    RAISE EXCEPTION 'The existing process_sale_checkout function is unavailable';
  END IF;

  old_movement_insert := $old$    INSERT INTO public.inventory_movements (item_id, type, qty, reference)
    VALUES (
      inventory_row.item_id,
      'Sale',
      -inventory_row.required_quantity,
      receipt_value
    );$old$;

  new_movement_insert := $new$    WITH recipe_movements AS (
      SELECT
        COALESCE(recipe.value->>'item_id', recipe.value->>'ingredient_id')::UUID AS item_id,
        COALESCE(
          recipe.value->>'quantity_required',
          recipe.value->>'quantity'
        )::NUMERIC * (line.value->>'quantity')::NUMERIC AS used_quantity,
        line.value->>'product_name' AS product_name,
        NULLIF(BTRIM(line.value->>'variant_name'), '') AS variant_name,
        (line.value->>'quantity')::INTEGER AS sold_quantity,
        ingredient.name AS ingredient_name,
        ingredient.unit AS ingredient_unit
      FROM jsonb_array_elements(item_lines) AS line(value)
      CROSS JOIN LATERAL (
        SELECT recipe.value
        FROM public.product_variants AS variant
        CROSS JOIN LATERAL jsonb_array_elements(
          COALESCE(variant.recipes, '[]'::JSONB)
        ) AS recipe(value)
        WHERE NULLIF(line.value->>'variant_id', '') IS NOT NULL
          AND variant.id = (line.value->>'variant_id')::UUID

        UNION ALL

        SELECT jsonb_build_object(
          'item_id', product_recipe.item_id,
          'quantity_required', product_recipe.quantity_required
        )
        FROM public.product_recipes AS product_recipe
        WHERE NULLIF(line.value->>'variant_id', '') IS NULL
          AND product_recipe.product_id = (line.value->>'product_id')::UUID
      ) AS recipe(value)
      JOIN public.inventory_items AS ingredient
        ON ingredient.id = COALESCE(
          recipe.value->>'item_id',
          recipe.value->>'ingredient_id'
        )::UUID
    )
    INSERT INTO public.inventory_movements (item_id, type, qty, reference)
    SELECT
      recipe_movements.item_id,
      'Sale',
      -recipe_movements.used_quantity,
      recipe_movements.product_name
        || COALESCE(' (' || recipe_movements.variant_name || ')', '')
        || ' x' || recipe_movements.sold_quantity::TEXT
        || ' used ' || recipe_movements.used_quantity::TEXT
        || recipe_movements.ingredient_unit
        || ' ' || recipe_movements.ingredient_name
        || ' [' || receipt_value || ']'
    FROM recipe_movements
    WHERE recipe_movements.item_id = inventory_row.item_id;$new$;

  IF position('recipe_movements AS (' IN function_ddl) > 0 THEN
    RETURN;
  END IF;

  IF position(old_movement_insert IN function_ddl) = 0 THEN
    RAISE EXCEPTION
      'Unable to safely update inventory movement references in process_sale_checkout';
  END IF;

  function_ddl := replace(function_ddl, old_movement_insert, new_movement_insert);
  EXECUTE function_ddl;
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
