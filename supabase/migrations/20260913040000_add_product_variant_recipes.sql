-- The live product_variants table uses name for the size label.
-- Add only the missing per-variant recipe payload; do not recreate the table.
ALTER TABLE public.product_variants
  ADD COLUMN IF NOT EXISTS recipes JSONB NOT NULL DEFAULT '[]'::jsonb;

NOTIFY pgrst, 'reload schema';
