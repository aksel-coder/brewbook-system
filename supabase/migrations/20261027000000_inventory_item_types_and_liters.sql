DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'inventory_items'
      AND column_name = 'added_stock'
  ) THEN
    ALTER TABLE public.inventory_items
      ADD COLUMN added_stock NUMERIC NOT NULL DEFAULT 0
      CHECK (added_stock >= 0);

    UPDATE public.inventory_items AS item
    SET added_stock = COALESCE((
      SELECT SUM(GREATEST(movement.qty, 0))
      FROM public.inventory_movements AS movement
      WHERE movement.item_id = item.id
        AND movement.type = 'In'
    ), 0);
  END IF;
END;
$$;

ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS item_type TEXT NOT NULL DEFAULT 'Ingredients';

UPDATE public.inventory_items
SET item_type = 'Ingredients'
WHERE item_type IS NULL OR item_type = 'Raw Ingredient';

ALTER TABLE public.inventory_items
  ALTER COLUMN item_type SET DEFAULT 'Ingredients',
  ALTER COLUMN item_type SET NOT NULL,
  ALTER COLUMN unit TYPE VARCHAR(10) USING unit::VARCHAR(10);

ALTER TABLE public.inventory_items
  DROP CONSTRAINT IF EXISTS inventory_items_item_type_check,
  DROP CONSTRAINT IF EXISTS inventory_items_unit_check,
  ADD CONSTRAINT inventory_items_item_type_check
    CHECK (item_type IN ('Ingredients', 'Materials')),
  ADD CONSTRAINT inventory_items_unit_check
    CHECK (unit IN ('g', 'ml', 'l', 'pcs', 'oz'));
