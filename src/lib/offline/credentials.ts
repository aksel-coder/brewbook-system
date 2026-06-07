import { withStore } from "./db";
import { put } from "./stores";
import { getSession, saveSession } from "./session";
import type { CachedCredential } from "./types";

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export async function saveCredential(input: {
  email: string;
  password: string;
  fullName?: string;
}) {
  const email = normalizeEmail(input.email);
  const session = await getSession();

  const record: CachedCredential = {
    email,
    password: input.password,
    userId: session?.userId ?? "",
    fullName: input.fullName ?? session?.fullName ?? "",
    username: session?.username ?? email.split("@")[0],
    isAdmin: session?.isAdmin ?? false,
    role: session?.role ?? "cashier",
    cached_at: new Date().toISOString(),
  };

  await put("credentials", record);
}

export async function getCredential(email: string): Promise<CachedCredential | null> {
  const key = normalizeEmail(email);
  const record = await withStore<CachedCredential | undefined>("credentials", "readonly", (store) =>
    store.get(key),
  );
  return record ?? null;
}

export async function enrichCredentialFromSession() {
  const session = await getSession();
  if (!session?.email) return;

  const existing = await getCredential(session.email);
  if (!existing) return;

  await put("credentials", {
    ...existing,
    userId: session.userId,
    fullName: session.fullName,
    username: session.username,
    isAdmin: session.isAdmin,
    role: session.role,
    cached_at: new Date().toISOString(),
  });
}
