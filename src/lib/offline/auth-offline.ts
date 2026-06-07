import { getCredential } from "./credentials";
import { getSession, saveSession } from "./session";

const OFFLINE_AUTH_KEY = "coffee-zone-offline-auth";

export function isOfflineAuthActive() {
  return typeof window !== "undefined" && localStorage.getItem(OFFLINE_AUTH_KEY) === "1";
}

export function activateOfflineAuth() {
  if (typeof window !== "undefined") localStorage.setItem(OFFLINE_AUTH_KEY, "1");
}

export function deactivateOfflineAuth() {
  if (typeof window !== "undefined") localStorage.removeItem(OFFLINE_AUTH_KEY);
}

export async function clearAllAuth() {
  deactivateOfflineAuth();
  const { supabase } = await import("@/integrations/supabase/client");
  await supabase.auth.signOut({ scope: "local" });
}

export async function isAppAuthenticated() {
  const { supabase } = await import("@/integrations/supabase/client");
  const { data } = await supabase.auth.getSession();
  if (data.session) return true;
  if (!isOfflineAuthActive()) return false;
  const session = await getSession();
  return !!session;
}

export async function tryOfflineLogin(email: string, password: string) {
  const cred = await getCredential(email);
  if (!cred || cred.password !== password) return false;

  const cached = await getSession();
  const useCached = cached?.email.toLowerCase() === cred.email;

  await saveSession({
    userId: useCached?.userId || cred.userId || crypto.randomUUID(),
    email: cred.email,
    isAdmin: useCached?.isAdmin ?? cred.isAdmin,
    role: useCached?.role ?? cred.role,
    fullName: useCached?.fullName || cred.fullName,
    username: useCached?.username || cred.username,
    offlineMode: true,
  });

  activateOfflineAuth();
  return true;
}

export async function restoreOnlineSessionFromCredentials() {
  if (!isOfflineAuthActive()) return false;

  const session = await getSession();
  if (!session?.email) return false;

  const cred = await getCredential(session.email);
  if (!cred) return false;

  const { supabase } = await import("@/integrations/supabase/client");
  const { error } = await supabase.auth.signInWithPassword({
    email: cred.email,
    password: cred.password,
  });

  if (error) return false;

  deactivateOfflineAuth();
  await saveSession({
    userId: session.userId,
    email: session.email,
    isAdmin: session.isAdmin,
    role: session.role,
    fullName: session.fullName,
    username: session.username,
    offlineMode: false,
  });

  return true;
}
