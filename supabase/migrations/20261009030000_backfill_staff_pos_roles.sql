BEGIN;

INSERT INTO public.user_roles (user_id, role)
SELECT users.id, 'cashier'::public.app_role
FROM auth.users AS users
WHERE NOT EXISTS (
  SELECT 1
  FROM public.user_roles AS roles
  WHERE roles.user_id = users.id
)
ON CONFLICT (user_id, role) DO NOTHING;

COMMIT;
