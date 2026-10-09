BEGIN;

DELETE FROM public.reservation_staff_access;

DROP FUNCTION IF EXISTS public.set_reservation_staff_access(UUID, BOOLEAN);

DROP POLICY IF EXISTS reservations_staff_read ON public.reservations;
DROP POLICY IF EXISTS reservations_admin_read ON public.reservations;
CREATE POLICY reservations_admin_read ON public.reservations
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS reservation_items_staff_read ON public.reservation_items;
DROP POLICY IF EXISTS reservation_items_admin_read ON public.reservation_items;
CREATE POLICY reservation_items_admin_read ON public.reservation_items
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP FUNCTION IF EXISTS public.has_reservation_staff_access();

COMMIT;
