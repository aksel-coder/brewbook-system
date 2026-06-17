import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';
import {
  getSupabaseUrl,
  hasSupabaseServiceRole,
  requireSupabaseServiceRoleKey,
} from '@/lib/supabase-env.server';

export { hasSupabaseServiceRole };

function createSupabaseAdminClient() {
  return createClient<Database>(getSupabaseUrl(), requireSupabaseServiceRoleKey(), {
    auth: {
      storage: undefined,
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

let _supabaseAdmin: ReturnType<typeof createSupabaseAdminClient> | undefined;

export function getSupabaseAdmin() {
  if (!_supabaseAdmin) _supabaseAdmin = createSupabaseAdminClient();
  return _supabaseAdmin;
}

export const supabaseAdmin = new Proxy({} as ReturnType<typeof createSupabaseAdminClient>, {
  get(_, prop, receiver) {
    return Reflect.get(getSupabaseAdmin(), prop, receiver);
  },
});
