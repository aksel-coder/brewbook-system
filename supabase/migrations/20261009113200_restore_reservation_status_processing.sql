-- Restore two-state reservation processing around the existing atomic checkout.
BEGIN;

ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'PENDING';

DO $$
DECLARE
  status_check RECORD;
BEGIN
  FOR status_check IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.reservations'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.reservations DROP CONSTRAINT %I',
      status_check.conname
    );
  END LOOP;
END;
$$;

UPDATE public.reservations AS reservation
SET status = CASE
  WHEN EXISTS (
    SELECT 1
    FROM public.sales AS sale
    WHERE sale.reservation_id = reservation.id
  ) THEN 'COMPLETED'
  ELSE 'PENDING'
END;

ALTER TABLE public.reservations
  ALTER COLUMN status SET DEFAULT 'PENDING',
  ALTER COLUMN status SET NOT NULL,
  ADD CONSTRAINT reservations_status_check
    CHECK (status IN ('PENDING', 'COMPLETED'));

CREATE INDEX IF NOT EXISTS reservations_status_idx
  ON public.reservations (status);

CREATE UNIQUE INDEX IF NOT EXISTS sales_reservation_id_unique
  ON public.sales (reservation_id)
  WHERE reservation_id IS NOT NULL;

DO $$
DECLARE
  function_ddl TEXT;
  old_guard TEXT;
  new_guard TEXT;
  final_return TEXT;
  restored_return TEXT;
BEGIN
  SELECT pg_get_functiondef(
    'public.process_sale_checkout(uuid,text,jsonb,uuid)'::regprocedure
  )
  INTO function_ddl;

  IF function_ddl IS NULL THEN
    RAISE EXCEPTION 'The existing process_sale_checkout function is unavailable';
  END IF;

  IF position('Ready for Pickup' IN function_ddl) > 0 THEN
    function_ddl := replace(
      function_ddl,
      $old$'Ready for Pickup'$old$,
      $new$'PENDING'$new$
    );
    function_ddl := replace(
      function_ddl,
      $old$'Completed'$old$,
      $new$'COMPLETED'$new$
    );
  ELSIF position($status$'PENDING'$status$ IN function_ddl) = 0
    OR position($status$'COMPLETED'$status$ IN function_ddl) = 0 THEN
    old_guard := E'IF NOT FOUND THEN\n      RAISE EXCEPTION ''Reservation not found'';\n    END IF;';
    new_guard := old_guard || E'\n    IF EXISTS (\n      SELECT 1\n      FROM public.reservations\n      WHERE id = p_reservation_id\n        AND status = ''COMPLETED''\n    ) THEN\n      SELECT * INTO sale_row\n      FROM public.sales\n      WHERE reservation_id = p_reservation_id;\n      IF FOUND THEN\n        RETURN jsonb_build_object(\n          ''sale'', to_jsonb(sale_row),\n          ''items'', ''[]''::JSONB,\n          ''subtotal'', sale_row.subtotal,\n          ''tax'', sale_row.tax,\n          ''total'', sale_row.total_amount\n        );\n      END IF;\n      RAISE EXCEPTION ''Completed reservation is missing its sale'';\n    END IF;\n    IF NOT EXISTS (\n      SELECT 1\n      FROM public.reservations\n      WHERE id = p_reservation_id\n        AND status = ''PENDING''\n    ) THEN\n      RAISE EXCEPTION ''Reservation is not pending'';\n    END IF;';

    IF position(old_guard IN function_ddl) = 0 THEN
      RAISE EXCEPTION 'Unable to safely add the pending reservation guard to process_sale_checkout';
    END IF;
    function_ddl := replace(function_ddl, old_guard, new_guard);

    final_return := E'RETURN jsonb_build_object(\n    ''sale'', to_jsonb(sale_row),\n    ''items'', item_lines,';
    restored_return := E'IF p_reservation_id IS NOT NULL THEN\n    UPDATE public.reservations\n    SET status = ''COMPLETED''\n    WHERE id = p_reservation_id\n      AND status = ''PENDING'';\n    IF NOT FOUND THEN\n      RAISE EXCEPTION ''Reservation status changed before completion'';\n    END IF;\n  END IF;\n\n  ' || final_return;

    IF position(final_return IN function_ddl) = 0 THEN
      RAISE EXCEPTION 'Unable to safely add the reservation completion transition to process_sale_checkout';
    END IF;
    function_ddl := replace(function_ddl, final_return, restored_return);
  END IF;

  IF position($pending$'PENDING'$pending$ IN function_ddl) = 0
    OR position($completed$'COMPLETED'$completed$ IN function_ddl) = 0 THEN
    RAISE EXCEPTION 'The process_sale_checkout function does not contain the restored status workflow';
  END IF;

  EXECUTE function_ddl;
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
