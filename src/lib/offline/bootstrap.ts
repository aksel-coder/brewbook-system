import { pullAllDataToIndexedDB } from "./pull";
import { hasValidSupabaseSession } from "./session-auth";

export async function bootstrapDataPull(fns: Parameters<typeof pullAllDataToIndexedDB>[0]) {
  if (typeof window === "undefined" || !navigator.onLine) return false;
  if (!(await hasValidSupabaseSession())) return false;
  try {
    await pullAllDataToIndexedDB(fns);
    return true;
  } catch (error) {
    console.warn("[offline] Data pull skipped:", error instanceof Error ? error.message : error);
    return false;
  }
}
