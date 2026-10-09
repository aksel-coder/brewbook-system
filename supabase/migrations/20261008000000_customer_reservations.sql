CREATE SEQUENCE IF NOT EXISTS public.reservation_number_seq START WITH 1;
GRANT USAGE, SELECT ON SEQUENCE public.reservation_number_seq TO service_role;

CREATE OR REPLACE FUNCTION public.next_reservation_number()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  sequence_value BIGINT;
BEGIN
  sequence_value := nextval('public.reservation_number_seq');
  RETURN 'R-' || lpad(sequence_value::TEXT, GREATEST(4, length(sequence_value::TEXT)), '0');
END;
$$;

REVOKE ALL ON FUNCTION public.next_reservation_number() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.next_reservation_number() TO service_role;

CREATE TABLE IF NOT EXISTS public.reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_number TEXT NOT NULL UNIQUE DEFAULT public.next_reservation_number(),
  customer_name TEXT NOT NULL CHECK (length(trim(customer_name)) BETWEEN 1 AND 120),
  contact_number TEXT NOT NULL CHECK (length(trim(contact_number)) BETWEEN 7 AND 20),
  pickup_date DATE NOT NULL,
  pickup_time TIME NOT NULL,
  customer_photo_path TEXT NOT NULL UNIQUE,
  notes TEXT NOT NULL DEFAULT '' CHECK (length(notes) <= 1000),
  total_amount NUMERIC(10, 2) NOT NULL CHECK (total_amount >= 0),
  status TEXT NOT NULL DEFAULT 'Pending'
    CHECK (status IN ('Pending', 'Confirmed', 'Preparing', 'Ready for Pickup', 'Completed', 'Cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT reservations_customer_photo_path_format
    CHECK (customer_photo_path ~ '^incoming/[0-9a-fA-F-]{36}\.(jpg|jpeg|png|webp)$')
);

CREATE TABLE IF NOT EXISTS public.reservation_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id UUID NOT NULL REFERENCES public.reservations(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  product_variant_id UUID REFERENCES public.product_variants(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  variant_name TEXT,
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 100),
  unit_price NUMERIC(10, 2) NOT NULL CHECK (unit_price >= 0),
  subtotal NUMERIC(10, 2) NOT NULL CHECK (subtotal >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reservations_created_at_idx
  ON public.reservations (created_at DESC);
CREATE INDEX IF NOT EXISTS reservations_status_idx
  ON public.reservations (status);
CREATE INDEX IF NOT EXISTS reservation_items_reservation_id_idx
  ON public.reservation_items (reservation_id);

CREATE TABLE IF NOT EXISTS public.reservation_staff_access (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  granted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.reservation_staff_access ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.reservation_staff_access TO authenticated;
GRANT ALL ON public.reservation_staff_access TO service_role;

DROP POLICY IF EXISTS reservation_staff_access_admin_read ON public.reservation_staff_access;
CREATE POLICY reservation_staff_access_admin_read ON public.reservation_staff_access
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE OR REPLACE FUNCTION public.has_reservation_staff_access()
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.reservation_staff_access
    WHERE user_id = auth.uid()
  )
$$;

REVOKE ALL ON FUNCTION public.has_reservation_staff_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_reservation_staff_access() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_reservation_staff_access(
  p_user_id UUID,
  p_allowed BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Forbidden: admin access required';
  END IF;

  IF p_allowed THEN
    IF NOT public.has_role(p_user_id, 'cashier'::public.app_role) THEN
      RAISE EXCEPTION 'Reservation access can only be granted to cashiers';
    END IF;
    INSERT INTO public.reservation_staff_access (user_id, granted_by)
    VALUES (p_user_id, auth.uid())
    ON CONFLICT (user_id) DO UPDATE
    SET granted_by = EXCLUDED.granted_by,
        granted_at = now();
  ELSE
    DELETE FROM public.reservation_staff_access WHERE user_id = p_user_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.set_reservation_staff_access(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_reservation_staff_access(UUID, BOOLEAN) TO authenticated;

ALTER TABLE public.reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reservation_items ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.reservations, public.reservation_items TO authenticated;
GRANT ALL ON public.reservations, public.reservation_items TO service_role;

DROP POLICY IF EXISTS reservations_staff_read ON public.reservations;
CREATE POLICY reservations_staff_read ON public.reservations
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR (
      public.has_role(auth.uid(), 'cashier'::public.app_role)
      AND public.has_reservation_staff_access()
    )
  );

DROP POLICY IF EXISTS reservation_items_staff_read ON public.reservation_items;
CREATE POLICY reservation_items_staff_read ON public.reservation_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.reservations AS reservation
      WHERE reservation.id = reservation_items.reservation_id
        AND (
          public.has_role(auth.uid(), 'admin'::public.app_role)
          OR (
            public.has_role(auth.uid(), 'cashier'::public.app_role)
            AND public.has_reservation_staff_access()
          )
        )
    )
  );

INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'customer-photos',
  'customer-photos',
  false,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']::TEXT[]
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = 5242880,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']::TEXT[];

DROP POLICY IF EXISTS customer_photos_staff_read ON storage.objects;

CREATE OR REPLACE FUNCTION public.create_customer_reservation(
  p_customer_name TEXT,
  p_contact_number TEXT,
  p_pickup_date DATE,
  p_pickup_time TIME,
  p_customer_photo_path TEXT,
  p_notes TEXT,
  p_items JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  requested_item JSONB;
  product_row RECORD;
  recipe_row RECORD;
  requested_product_id UUID;
  requested_variant_id UUID;
  requested_quantity INTEGER;
  variant_count INTEGER;
  recipe_count INTEGER;
  item_key TEXT;
  seen_item_keys TEXT[] := ARRAY[]::TEXT[];
  finished_good_demand JSONB := '{}'::JSONB;
  ingredient_demand JSONB := '{}'::JSONB;
  demand_quantity NUMERIC;
  variant_name_snapshot TEXT;
  variant_price NUMERIC(10, 2);
  variant_recipes JSONB;
  item_price NUMERIC(10, 2);
  item_subtotal NUMERIC(10, 2);
  reservation_total NUMERIC(10, 2) := 0;
  calculated_items JSONB := '[]'::JSONB;
  reservation_row public.reservations%ROWTYPE;
BEGIN
  IF p_customer_name IS NULL OR length(trim(p_customer_name)) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'Enter a valid customer name';
  END IF;
  IF p_contact_number IS NULL OR p_contact_number !~ '^[0-9+() .-]{7,20}$' THEN
    RAISE EXCEPTION 'Enter a valid contact number';
  END IF;
  IF p_pickup_date IS NULL OR p_pickup_date < current_date THEN
    RAISE EXCEPTION 'Pickup date cannot be in the past';
  END IF;
  IF p_pickup_time IS NULL THEN
    RAISE EXCEPTION 'Pickup time is required';
  END IF;
  IF p_customer_photo_path IS NULL
     OR p_customer_photo_path !~ '^incoming/[0-9a-fA-F-]{36}\.(jpg|jpeg|png|webp)$' THEN
    RAISE EXCEPTION 'Invalid customer photo reference';
  END IF;
  IF p_notes IS NULL OR length(p_notes) > 1000 THEN
    RAISE EXCEPTION 'Notes must be 1000 characters or fewer';
  END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Add between 1 and 30 reservation items';
  END IF;
  IF jsonb_array_length(p_items) < 1 OR jsonb_array_length(p_items) > 30 THEN
    RAISE EXCEPTION 'Add between 1 and 30 reservation items';
  END IF;

  FOR requested_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    IF jsonb_typeof(requested_item) <> 'object'
       OR COALESCE(requested_item->>'product_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       OR COALESCE(requested_item->>'quantity', '') !~ '^[1-9][0-9]*$' THEN
      RAISE EXCEPTION 'Invalid reservation item';
    END IF;
    IF length(requested_item->>'quantity') > 3 THEN
      RAISE EXCEPTION 'Quantity must be between 1 and 100';
    END IF;
    IF (requested_item->>'quantity')::INTEGER > 100 THEN
      RAISE EXCEPTION 'Quantity must be between 1 and 100';
    END IF;

    requested_product_id := (requested_item->>'product_id')::UUID;
    requested_quantity := (requested_item->>'quantity')::INTEGER;
    requested_variant_id := NULL;
    IF requested_item ? 'variant_id' AND requested_item->>'variant_id' IS NOT NULL THEN
      IF requested_item->>'variant_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RAISE EXCEPTION 'Invalid product variant';
      END IF;
      requested_variant_id := (requested_item->>'variant_id')::UUID;
    END IF;
    item_key := requested_product_id::TEXT || ':' || COALESCE(requested_variant_id::TEXT, 'default');
    IF item_key = ANY(seen_item_keys) THEN
      RAISE EXCEPTION 'Each product and variant can only appear once';
    END IF;
    seen_item_keys := array_append(seen_item_keys, item_key);

    SELECT product.id, product.name, product.price, product.stock_quantity,
           category.category_type
    INTO product_row
    FROM public.products AS product
    LEFT JOIN public.categories AS category ON category.id = product.category_id
    WHERE product.id = requested_product_id
      AND product.is_active = true;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Product is unavailable';
    END IF;

    SELECT count(*)::INTEGER INTO variant_count
    FROM public.product_variants
    WHERE product_id = requested_product_id;

    variant_name_snapshot := NULL;
    variant_price := NULL;
    variant_recipes := NULL;
    IF requested_variant_id IS NOT NULL THEN
      SELECT name, price, recipes
      INTO variant_name_snapshot, variant_price, variant_recipes
      FROM public.product_variants
      WHERE id = requested_variant_id
        AND product_id = requested_product_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Selected product variant is unavailable';
      END IF;
    ELSIF variant_count > 0 THEN
      RAISE EXCEPTION 'Select a product variant';
    END IF;

    item_price := COALESCE(variant_price, product_row.price);
    item_subtotal := item_price * requested_quantity;

    IF product_row.category_type = 'recipe_based' THEN
      IF requested_variant_id IS NOT NULL THEN
        IF jsonb_typeof(variant_recipes) <> 'array'
           OR jsonb_array_length(variant_recipes) = 0 THEN
          RAISE EXCEPTION 'Selected product variant has no recipe';
        END IF;

        FOR recipe_row IN
          SELECT COALESCE(recipe->>'item_id', recipe->>'ingredient_id')::UUID AS item_id,
                 SUM(COALESCE(recipe->>'quantity_required', recipe->>'quantity')::NUMERIC) AS required_quantity
          FROM jsonb_array_elements(variant_recipes) AS recipe
          GROUP BY COALESCE(recipe->>'item_id', recipe->>'ingredient_id')::UUID
        LOOP
          IF recipe_row.item_id IS NULL OR recipe_row.required_quantity <= 0 THEN
            RAISE EXCEPTION 'Selected product variant has an invalid recipe';
          END IF;
          demand_quantity := COALESCE((ingredient_demand->>recipe_row.item_id::TEXT)::NUMERIC, 0)
            + recipe_row.required_quantity * requested_quantity;
          ingredient_demand := jsonb_set(
            ingredient_demand,
            ARRAY[recipe_row.item_id::TEXT],
            to_jsonb(demand_quantity),
            true
          );
        END LOOP;
      ELSE
        SELECT count(*)::INTEGER INTO recipe_count
        FROM public.product_recipes
        WHERE product_id = requested_product_id;
        IF recipe_count = 0 THEN
          RAISE EXCEPTION 'Recipe-based product has no recipe';
        END IF;

        FOR recipe_row IN
          SELECT item_id, SUM(quantity_required) AS required_quantity
          FROM public.product_recipes
          WHERE product_id = requested_product_id
          GROUP BY item_id
        LOOP
          demand_quantity := COALESCE((ingredient_demand->>recipe_row.item_id::TEXT)::NUMERIC, 0)
            + recipe_row.required_quantity * requested_quantity;
          ingredient_demand := jsonb_set(
            ingredient_demand,
            ARRAY[recipe_row.item_id::TEXT],
            to_jsonb(demand_quantity),
            true
          );
        END LOOP;
      END IF;
    ELSE
      demand_quantity := COALESCE((finished_good_demand->>requested_product_id::TEXT)::NUMERIC, 0)
        + requested_quantity;
      finished_good_demand := jsonb_set(
        finished_good_demand,
        ARRAY[requested_product_id::TEXT],
        to_jsonb(demand_quantity),
        true
      );
    END IF;

    reservation_total := reservation_total + item_subtotal;
    calculated_items := calculated_items || jsonb_build_array(jsonb_build_object(
      'product_id', requested_product_id,
      'product_variant_id', requested_variant_id,
      'product_name', product_row.name,
      'variant_name', variant_name_snapshot,
      'quantity', requested_quantity,
      'unit_price', item_price,
      'subtotal', item_subtotal
    ));
  END LOOP;

  FOR recipe_row IN
    SELECT key::UUID AS item_id, value::NUMERIC AS required_quantity
    FROM jsonb_each_text(ingredient_demand)
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM public.inventory_items AS ingredient
      WHERE ingredient.id = recipe_row.item_id
        AND ingredient.current_stock >= recipe_row.required_quantity
    ) THEN
      RAISE EXCEPTION 'Insufficient ingredient stock';
    END IF;
  END LOOP;

  FOR recipe_row IN
    SELECT key::UUID AS product_id, value::NUMERIC AS required_quantity
    FROM jsonb_each_text(finished_good_demand)
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM public.products AS product
      WHERE product.id = recipe_row.product_id
        AND product.is_active = true
        AND product.stock_quantity >= recipe_row.required_quantity
    ) THEN
      RAISE EXCEPTION 'Insufficient product stock';
    END IF;
  END LOOP;

  INSERT INTO public.reservations (
    customer_name,
    contact_number,
    pickup_date,
    pickup_time,
    customer_photo_path,
    notes,
    total_amount
  )
  VALUES (
    trim(p_customer_name),
    trim(p_contact_number),
    p_pickup_date,
    p_pickup_time,
    p_customer_photo_path,
    p_notes,
    reservation_total
  )
  RETURNING * INTO reservation_row;

  INSERT INTO public.reservation_items (
    reservation_id,
    product_id,
    product_variant_id,
    product_name,
    variant_name,
    quantity,
    unit_price,
    subtotal
  )
  SELECT reservation_row.id,
         (item->>'product_id')::UUID,
         NULLIF(item->>'product_variant_id', '')::UUID,
         item->>'product_name',
         item->>'variant_name',
         (item->>'quantity')::INTEGER,
         (item->>'unit_price')::NUMERIC,
         (item->>'subtotal')::NUMERIC
  FROM jsonb_array_elements(calculated_items) AS item;

  RETURN jsonb_build_object(
    'id', reservation_row.id,
    'reservation_number', reservation_row.reservation_number,
    'total_amount', reservation_row.total_amount,
    'created_at', reservation_row.created_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_customer_reservation(TEXT, TEXT, DATE, TIME, TEXT, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_customer_reservation(TEXT, TEXT, DATE, TIME, TEXT, TEXT, JSONB)
  TO service_role;

NOTIFY pgrst, 'reload schema';
