BEGIN;

ALTER TABLE public.reservations
  DROP CONSTRAINT IF EXISTS reservations_status_check,
  ADD CONSTRAINT reservations_status_check
    CHECK (status IN ('PENDING', 'COMPLETED', 'CANCELED'));

COMMIT;
