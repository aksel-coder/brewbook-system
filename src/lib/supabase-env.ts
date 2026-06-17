/** Public Supabase config — safe for browser and server. */

function envError(names: string[]): never {
  throw new Error(
    `Missing Supabase environment variable(s): ${names.join(", ")}. ` +
      "Set both server (SUPABASE_*) and client (VITE_SUPABASE_*) entries in .env.",
  );
}

export function getSupabaseUrl(): string {
  const url = import.meta.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  if (!url) envError(["VITE_SUPABASE_URL", "SUPABASE_URL"]);
  return url;
}

export function getSupabasePublishableKey(): string {
  const key =
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!key) envError(["VITE_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_PUBLISHABLE_KEY"]);
  return key;
}

/** Dev-only sanity check — URL project ref should match SUPABASE_PROJECT_ID when set. */
export function warnIfProjectIdMismatch() {
  if (import.meta.env.PROD) return;
  const url = getSupabaseUrl();
  const refFromUrl = url.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];
  const projectId =
    import.meta.env.VITE_SUPABASE_PROJECT_ID || process.env.SUPABASE_PROJECT_ID;
  if (refFromUrl && projectId && refFromUrl !== projectId) {
    console.warn(
      `[Supabase] Project mismatch: URL ref "${refFromUrl}" ≠ SUPABASE_PROJECT_ID "${projectId}"`,
    );
  }
}
