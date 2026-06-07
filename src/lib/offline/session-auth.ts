import { supabase } from "@/integrations/supabase/client";

/** Refresh the Supabase session if it is missing or close to expiry. */
export async function ensureFreshSupabaseSession() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;

  const now = Math.floor(Date.now() / 1000);
  const expiresAt = session.expires_at ?? 0;
  if (expiresAt - now > 120) return session;

  const { data: refreshed, error } = await supabase.auth.refreshSession();
  if (error || !refreshed.session) return session;
  return refreshed.session;
}

export async function hasValidSupabaseSession() {
  const session = await ensureFreshSupabaseSession();
  return !!session?.access_token;
}
