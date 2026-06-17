/** Server-only Supabase secrets — never import from client components. */
import { getSupabaseUrl } from "./supabase-env";

export { getSupabaseUrl };

export function getSupabaseServiceRoleKey(): string | undefined {
  return process.env.SUPABASE_SERVICE_ROLE_KEY;
}

export function hasSupabaseServiceRole(): boolean {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return false;

  if (key.startsWith("sb_publishable_")) return false;

  // New Supabase secret key format
  if (key.startsWith("sb_secret_")) return true;

  // Legacy JWT — must be service_role, not anon
  try {
    const part = key.split(".")[1];
    if (!part) return false;
    const payload = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
    return payload.role === "service_role";
  } catch {
    return false;
  }
}

export function requireSupabaseServiceRoleKey(): string {
  const key = getSupabaseServiceRoleKey();
  if (!key) {
    throw new Error(
      "Missing SUPABASE_SERVICE_ROLE_KEY in .env (server-only). " +
        "Supabase Dashboard → Settings → API → service_role secret.",
    );
  }
  if (!hasSupabaseServiceRole()) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY does not look like a service role key. " +
        "Use the service_role secret, not the anon/publishable key.",
    );
  }
  return key;
}
