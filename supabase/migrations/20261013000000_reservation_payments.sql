BEGIN;

CREATE TABLE IF NOT EXISTS public.reservation_payments (
  reservation_id UUID PRIMARY KEY REFERENCES public.reservations(id) ON DELETE CASCADE,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'gcash')),
  payment_status TEXT NOT NULL CHECK (
    payment_status IN ('awaiting_payment', 'awaiting_verification', 'paid', 'rejected')
  ),
  transaction_reference TEXT CHECK (
    transaction_reference IS NULL OR length(transaction_reference) <= 120
  ),
  screenshot_path TEXT UNIQUE,
  rejection_reason TEXT CHECK (rejection_reason IS NULL OR length(rejection_reason) <= 500),
  verified_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT reservation_payments_method_state_check CHECK (
    (payment_method = 'cash'
      AND payment_status IN ('awaiting_payment', 'paid')
      AND screenshot_path IS NULL
      AND transaction_reference IS NULL)
    OR
    (payment_method = 'gcash'
      AND payment_status IN ('awaiting_verification', 'paid', 'rejected')
      AND screenshot_path IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS public.reservation_payment_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id UUID NOT NULL REFERENCES public.reservations(id) ON DELETE CASCADE,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'gcash')),
  payment_status TEXT NOT NULL CHECK (
    payment_status IN ('awaiting_payment', 'awaiting_verification', 'paid', 'rejected')
  ),
  transaction_reference TEXT,
  rejection_reason TEXT,
  changed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_by_role TEXT NOT NULL CHECK (changed_by_role IN ('customer', 'admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reservation_payments_status_idx
  ON public.reservation_payments (payment_status, created_at DESC);
CREATE INDEX IF NOT EXISTS reservation_payment_events_reservation_idx
  ON public.reservation_payment_events (reservation_id, created_at DESC);

ALTER TABLE public.reservation_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reservation_payment_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.reservation_payments, public.reservation_payment_events
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.reservation_payments, public.reservation_payment_events TO authenticated;
GRANT ALL ON public.reservation_payments, public.reservation_payment_events TO service_role;

DROP POLICY IF EXISTS reservation_payments_admin_read ON public.reservation_payments;
CREATE POLICY reservation_payments_admin_read ON public.reservation_payments
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS reservation_payment_events_admin_read ON public.reservation_payment_events;
CREATE POLICY reservation_payment_events_admin_read ON public.reservation_payment_events
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

INSERT INTO storage.buckets (
  id, name, public, file_size_limit, allowed_mime_types
)
VALUES (
  'reservation-payment-evidence',
  'reservation-payment-evidence',
  false,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']::TEXT[]
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = 5242880,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']::TEXT[];

CREATE OR REPLACE FUNCTION public.record_reservation_payment_submission(
  p_reservation_id UUID,
  p_payment_method TEXT,
  p_transaction_reference TEXT,
  p_screenshot_path TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  existing_payment public.reservation_payments%ROWTYPE;
  reservation_amount NUMERIC(10, 2);
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Payment submissions must be recorded by the trusted server';
  END IF;
  IF p_reservation_id IS NULL OR p_payment_method NOT IN ('cash', 'gcash') THEN
    RAISE EXCEPTION 'Invalid payment submission';
  END IF;
  IF p_transaction_reference IS NOT NULL
     AND length(trim(p_transaction_reference)) > 120 THEN
    RAISE EXCEPTION 'Transaction reference must be 120 characters or fewer';
  END IF;
  IF p_payment_method = 'cash' AND (p_screenshot_path IS NOT NULL OR p_transaction_reference IS NOT NULL) THEN
    RAISE EXCEPTION 'Cash payment cannot include GCash evidence';
  END IF;
  IF p_payment_method = 'gcash'
     AND (p_screenshot_path IS NULL OR p_screenshot_path !~ '^incoming/[0-9a-fA-F-]{36}\.(jpg|jpeg|png|webp)$') THEN
    RAISE EXCEPTION 'A valid GCash screenshot is required';
  END IF;

  SELECT total_amount INTO reservation_amount
  FROM public.reservations
  WHERE id = p_reservation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reservation not found';
  END IF;

  SELECT * INTO existing_payment
  FROM public.reservation_payments
  WHERE reservation_id = p_reservation_id
  FOR UPDATE;
  IF FOUND THEN
    IF existing_payment.payment_method = p_payment_method
       AND existing_payment.transaction_reference IS NOT DISTINCT FROM NULLIF(trim(p_transaction_reference), '')
       AND existing_payment.screenshot_path IS NOT DISTINCT FROM p_screenshot_path THEN
      RETURN jsonb_build_object(
        'payment_method', existing_payment.payment_method,
        'payment_status', existing_payment.payment_status
      );
    END IF;
    RAISE EXCEPTION 'A payment submission already exists for this reservation';
  END IF;

  INSERT INTO public.reservation_payments (
    reservation_id,
    payment_method,
    payment_status,
    transaction_reference,
    screenshot_path
  )
  VALUES (
    p_reservation_id,
    p_payment_method,
    CASE WHEN p_payment_method = 'cash' THEN 'awaiting_payment' ELSE 'awaiting_verification' END,
    NULLIF(trim(p_transaction_reference), ''),
    p_screenshot_path
  )
  RETURNING * INTO existing_payment;

  INSERT INTO public.reservation_payment_events (
    reservation_id, payment_method, payment_status, transaction_reference,
    changed_by_role
  )
  VALUES (
    p_reservation_id, p_payment_method, existing_payment.payment_status,
    existing_payment.transaction_reference, 'customer'
  );

  RETURN jsonb_build_object(
    'payment_method', existing_payment.payment_method,
    'payment_status', existing_payment.payment_status,
    'total_amount', reservation_amount
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_reservation_payment_submission(UUID, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_reservation_payment_submission(UUID, TEXT, TEXT, TEXT)
  TO service_role;

CREATE OR REPLACE FUNCTION public.verify_reservation_payment(
  p_reservation_id UUID,
  p_actor_user_id UUID,
  p_action TEXT,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  payment_row public.reservation_payments%ROWTYPE;
  next_status TEXT;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role'
     OR p_actor_user_id IS NULL
     OR NOT public.has_role(p_actor_user_id, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Forbidden: Admin access is required';
  END IF;
  IF p_action NOT IN ('confirm_gcash', 'reject_gcash', 'mark_cash_paid') THEN
    RAISE EXCEPTION 'Invalid payment verification action';
  END IF;
  IF p_action = 'reject_gcash' AND length(trim(COALESCE(p_reason, ''))) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'A rejection reason of 1 to 500 characters is required';
  END IF;

  SELECT * INTO payment_row
  FROM public.reservation_payments
  WHERE reservation_id = p_reservation_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reservation payment was not found';
  END IF;
  IF p_action IN ('confirm_gcash', 'reject_gcash')
     AND (payment_row.payment_method <> 'gcash' OR payment_row.payment_status <> 'awaiting_verification') THEN
    RAISE EXCEPTION 'GCash payment is not awaiting verification';
  END IF;
  IF p_action = 'mark_cash_paid'
     AND (payment_row.payment_method <> 'cash' OR payment_row.payment_status <> 'awaiting_payment') THEN
    RAISE EXCEPTION 'Cash payment is not awaiting payment';
  END IF;

  next_status := CASE
    WHEN p_action IN ('confirm_gcash', 'mark_cash_paid') THEN 'paid'
    ELSE 'rejected'
  END;

  UPDATE public.reservation_payments
  SET payment_status = next_status,
      rejection_reason = CASE WHEN p_action = 'reject_gcash' THEN trim(p_reason) ELSE NULL END,
      verified_by = p_actor_user_id,
      verified_at = now(),
      updated_at = now()
  WHERE reservation_id = p_reservation_id
  RETURNING * INTO payment_row;

  INSERT INTO public.reservation_payment_events (
    reservation_id, payment_method, payment_status, transaction_reference,
    rejection_reason, changed_by, changed_by_role
  )
  VALUES (
    p_reservation_id, payment_row.payment_method, payment_row.payment_status,
    payment_row.transaction_reference, payment_row.rejection_reason, p_actor_user_id, 'admin'
  );

  RETURN jsonb_build_object(
    'payment_method', payment_row.payment_method,
    'payment_status', payment_row.payment_status,
    'rejection_reason', payment_row.rejection_reason,
    'verified_at', payment_row.verified_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.verify_reservation_payment(UUID, UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_reservation_payment(UUID, UUID, TEXT, TEXT)
  TO service_role;

CREATE OR REPLACE FUNCTION public.guard_reservation_completion_payment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'COMPLETED' AND OLD.status IS DISTINCT FROM NEW.status
     AND EXISTS (
       SELECT 1
       FROM public.reservation_payments
       WHERE reservation_id = NEW.id
         AND payment_status <> 'paid'
     ) THEN
    RAISE EXCEPTION 'Reservation payment must be verified before completion';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reservations_require_paid_payment ON public.reservations;
CREATE TRIGGER reservations_require_paid_payment
  BEFORE UPDATE OF status ON public.reservations
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_reservation_completion_payment();

NOTIFY pgrst, 'reload schema';
COMMIT;
