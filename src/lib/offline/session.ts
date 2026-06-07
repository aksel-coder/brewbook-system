import { getMeta, setMeta } from "./stores";
import type { CachedSession } from "./types";

const SESSION_KEY = "session";

export async function saveSession(session: Omit<CachedSession, "cached_at">) {
  await setMeta<CachedSession>(SESSION_KEY, {
    ...session,
    cached_at: new Date().toISOString(),
  });
}

export async function getSession(): Promise<CachedSession | null> {
  return getMeta<CachedSession>(SESSION_KEY);
}

export async function clearSession() {
  await setMeta(SESSION_KEY, null);
}
