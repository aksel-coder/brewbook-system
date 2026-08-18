-- Allow authenticated admin and cashier (staff) users to update inventory product stock.
DROP POLICY IF EXISTS "products_inventory_admin_or_staff_update" ON public.products;
CREATE POLICY "products_inventory_admin_or_staff_update"
ON public.products
FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'cashier'))
WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'cashier'));

-- Allow authenticated admin and cashier staff to record inventory movements.
DROP POLICY IF EXISTS "inv_insert_admin_or_staff" ON public.inventory_transactions;
CREATE POLICY "inv_insert_admin_or_staff"
ON public.inventory_transactions
FOR INSERT
TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'cashier')
  OR created_by = auth.uid()
);
