BEGIN;

ALTER TABLE public.customer_reviews
  ALTER COLUMN status SET DEFAULT 'published';

UPDATE public.customer_reviews
SET status = 'published',
    updated_at = now()
WHERE status = 'pending';

DROP POLICY IF EXISTS customer_reviews_admin_read ON public.customer_reviews;
DROP POLICY IF EXISTS customer_reviews_admin_update ON public.customer_reviews;
REVOKE UPDATE (status) ON public.customer_reviews FROM authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
