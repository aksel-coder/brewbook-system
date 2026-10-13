BEGIN;

CREATE TABLE IF NOT EXISTS public.customer_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id UUID NOT NULL UNIQUE
    REFERENCES public.reservations(id) ON DELETE CASCADE,
  rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT CHECK (comment IS NULL OR length(comment) <= 1000),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'published', 'hidden', 'removed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS customer_reviews_public_created_idx
  ON public.customer_reviews (created_at DESC)
  WHERE status = 'published';

ALTER TABLE public.customer_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.customer_reviews FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.customer_reviews TO anon, authenticated;
GRANT UPDATE (status) ON public.customer_reviews TO authenticated;
GRANT ALL ON public.customer_reviews TO service_role;

DROP POLICY IF EXISTS customer_reviews_public_read ON public.customer_reviews;
CREATE POLICY customer_reviews_public_read ON public.customer_reviews
  FOR SELECT TO anon, authenticated
  USING (status = 'published');

DROP POLICY IF EXISTS customer_reviews_admin_read ON public.customer_reviews;
CREATE POLICY customer_reviews_admin_read ON public.customer_reviews
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS customer_reviews_admin_update ON public.customer_reviews;
CREATE POLICY customer_reviews_admin_update ON public.customer_reviews
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE OR REPLACE FUNCTION public.submit_customer_review(
  p_reservation_number TEXT,
  p_contact_number TEXT,
  p_rating SMALLINT,
  p_comment TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  matched_reservation_id UUID;
  created_review public.customer_reviews%ROWTYPE;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Review submissions must be validated by the trusted server';
  END IF;
  IF p_reservation_number IS NULL
     OR length(trim(p_reservation_number)) NOT BETWEEN 1 AND 30
     OR p_contact_number IS NULL
     OR length(trim(p_contact_number)) NOT BETWEEN 7 AND 20
     OR trim(p_contact_number) !~ '^[0-9+() .-]+$'
     OR p_rating IS NULL
     OR p_rating NOT BETWEEN 1 AND 5
     OR (p_comment IS NOT NULL AND length(trim(p_comment)) > 1000) THEN
    RAISE EXCEPTION 'Enter a valid reservation number, contact number, rating, and comment';
  END IF;

  SELECT reservation.id
  INTO matched_reservation_id
  FROM public.reservations AS reservation
  WHERE upper(reservation.reservation_number) = upper(trim(p_reservation_number))
    AND reservation.status = 'COMPLETED'
    AND regexp_replace(reservation.contact_number, '[^0-9]', '', 'g')
      = regexp_replace(trim(p_contact_number), '[^0-9]', '', 'g')
    AND EXISTS (
      SELECT 1
      FROM public.sales AS sale
      WHERE sale.reservation_id = reservation.id
    );
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A completed reservation with that reservation number and contact number was not found';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.customer_reviews
    WHERE reservation_id = matched_reservation_id
  ) THEN
    RAISE EXCEPTION 'A review has already been submitted for this reservation';
  END IF;

  INSERT INTO public.customer_reviews (reservation_id, rating, comment)
  VALUES (matched_reservation_id, p_rating, NULLIF(trim(p_comment), ''))
  RETURNING * INTO created_review;

  RETURN jsonb_build_object(
    'id', created_review.id,
    'status', created_review.status
  );
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'A review has already been submitted for this reservation';
END;
$$;

REVOKE ALL ON FUNCTION public.submit_customer_review(TEXT, TEXT, SMALLINT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_customer_review(TEXT, TEXT, SMALLINT, TEXT)
  TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
