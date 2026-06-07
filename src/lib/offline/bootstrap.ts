import { pullAllDataToIndexedDB } from "./pull";

export async function bootstrapDataPull(fns: Parameters<typeof pullAllDataToIndexedDB>[0]) {
  if (typeof window === "undefined" || !navigator.onLine) return false;
  try {
    await pullAllDataToIndexedDB(fns);
    return true;
  } catch (error) {
    console.error("[offline] Failed to pull data into IndexedDB:", error);
    return false;
  }
}
