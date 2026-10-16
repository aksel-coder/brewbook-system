BEGIN;

DROP TRIGGER IF EXISTS profiles_guard_active_status ON public.profiles;
DROP FUNCTION IF EXISTS public.guard_profile_active_status();
DROP FUNCTION IF EXISTS public.admin_deactivate_staff_user(UUID);
DROP FUNCTION IF EXISTS public.admin_delete_user(UUID);

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles AS user_role
    WHERE user_role.user_id = _user_id
      AND user_role.role = _role
  )
$$;

ALTER TABLE public.profiles
  DROP COLUMN IF EXISTS is_active;

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS operator_name TEXT;

UPDATE public.sales AS sale
SET operator_name = COALESCE(
  NULLIF(profile.full_name, ''),
  NULLIF(auth_user.raw_user_meta_data ->> 'full_name', ''),
  NULLIF(split_part(COALESCE(auth_user.email, ''), '@', 1), ''),
  'Unknown staff'
)
FROM auth.users AS auth_user
LEFT JOIN public.profiles AS profile ON profile.id = auth_user.id
WHERE sale.user_id = auth_user.id
  AND sale.operator_name IS NULL;

UPDATE public.sales
SET operator_name = 'Unknown staff'
WHERE operator_name IS NULL;

ALTER TABLE public.sales
  ALTER COLUMN operator_name SET DEFAULT 'Unknown staff',
  ALTER COLUMN operator_name SET NOT NULL;

CREATE OR REPLACE FUNCTION public.set_sale_operator_name()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  SELECT COALESCE(
    NULLIF(profile.full_name, ''),
    NULLIF(auth_user.raw_user_meta_data ->> 'full_name', ''),
    NULLIF(split_part(COALESCE(auth_user.email, ''), '@', 1), ''),
    'Unknown staff'
  )
  INTO NEW.operator_name
  FROM auth.users AS auth_user
  LEFT JOIN public.profiles AS profile ON profile.id = auth_user.id
  WHERE auth_user.id = NEW.user_id;

  NEW.operator_name := COALESCE(NULLIF(NEW.operator_name, ''), 'Unknown staff');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sales_set_operator_name ON public.sales;
CREATE TRIGGER sales_set_operator_name
  BEFORE INSERT ON public.sales
  FOR EACH ROW
  EXECUTE FUNCTION public.set_sale_operator_name();

ALTER TABLE public.sales
  DROP CONSTRAINT IF EXISTS sales_user_id_fkey;

ALTER TABLE public.inventory_transactions
  DROP CONSTRAINT IF EXISTS inventory_transactions_created_by_fkey,
  ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE public.inventory_transactions
  ADD CONSTRAINT inventory_transactions_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.offline_sale_sync
  DROP CONSTRAINT IF EXISTS offline_sale_sync_user_id_fkey,
  ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.offline_sale_sync
  ADD CONSTRAINT offline_sale_sync_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.prevent_last_admin_deletion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  remaining_admins BIGINT;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = OLD.id
      AND role = 'admin'::public.app_role
  ) THEN
    PERFORM pg_advisory_xact_lock(901801);

    SELECT COUNT(DISTINCT auth_user.id)
    INTO remaining_admins
    FROM auth.users AS auth_user
    JOIN public.user_roles AS user_role ON user_role.user_id = auth_user.id
    WHERE user_role.role = 'admin'::public.app_role;

    IF remaining_admins <= 1 THEN
      RAISE EXCEPTION 'The last authorized Admin account cannot be deleted';
    END IF;
  END IF;
  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_last_admin_deletion() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS auth_users_prevent_last_admin_deletion ON auth.users;
CREATE TRIGGER auth_users_prevent_last_admin_deletion
  BEFORE DELETE ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_last_admin_deletion();

NOTIFY pgrst, 'reload schema';
COMMIT;
