CREATE OR REPLACE FUNCTION public.wipe_business_data()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  table_name TEXT;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Forbidden: admin access required';
  END IF;

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

REVOKE ALL ON FUNCTION public.wipe_business_data() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wipe_business_data() TO authenticated;