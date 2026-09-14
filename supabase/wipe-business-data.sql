-- Manual business-data wipe. Run only against the intended database.
DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOR table_name IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename = ANY (ARRAY[
        'sale_items',
        'sales',
        'inventory_transactions',
        'inventory_movements',
        'product_recipes',
        'product_variants',
        'products',
        'inventory_items',
        'categories'
      ])
  LOOP
    EXECUTE format('TRUNCATE TABLE public.%I RESTART IDENTITY CASCADE', table_name);
  END LOOP;
END;
$$;