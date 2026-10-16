BEGIN;

CREATE OR REPLACE FUNCTION public.enforce_reservation_contact_number_format()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.contact_number IS NULL OR NEW.contact_number !~ '^[0-9]{11}$' THEN
    RAISE EXCEPTION 'Contact number must be exactly 11 digits.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reservations_contact_number_format ON public.reservations;
CREATE TRIGGER reservations_contact_number_format
  BEFORE INSERT OR UPDATE OF contact_number ON public.reservations
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_reservation_contact_number_format();

REVOKE ALL ON FUNCTION public.enforce_reservation_contact_number_format()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_reservation_contact_number_format()
  TO service_role;

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
  IF p_contact_number IS NULL OR p_contact_number !~ '^[0-9]{11}$' THEN
    RAISE EXCEPTION 'Contact number must be exactly 11 digits.';
  END IF;
  IF p_reservation_number IS NULL
     OR length(trim(p_reservation_number)) NOT BETWEEN 1 AND 30
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
    AND regexp_replace(reservation.contact_number, '[^0-9]', '', 'g') = p_contact_number
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
