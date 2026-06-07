import { isBrowserOnline, isClient } from "./data-access";
import { getPendingSales, removePendingSale, updatePendingSale } from "./sales";
import { getPendingMutations, getTotalPendingCount, removePendingMutation, updatePendingMutation } from "./mutations";
import { pullAllDataToIndexedDB } from "./pull";
import type { SaleItemInput } from "./types";

export { isBrowserOnline, isClient } from "./data-access";

type SyncFns = {
  createSale: (input: { data: { items: SaleItemInput[]; tax_rate: number } }) => Promise<unknown>;
  adjustInventory: (input: { data: Record<string, unknown> }) => Promise<unknown>;
  upsertProduct: (input: { data: Record<string, unknown> }) => Promise<unknown>;
  deleteProduct: (input: { data: Record<string, unknown> }) => Promise<unknown>;
  upsertCategory: (input: { data: Record<string, unknown> }) => Promise<unknown>;
  deleteCategory: (input: { data: Record<string, unknown> }) => Promise<unknown>;
  updateUserRole: (input: { data: Record<string, unknown> }) => Promise<unknown>;
  deleteUser: (input: { data: Record<string, unknown> }) => Promise<unknown>;
  claimFirstAdmin: () => Promise<unknown>;
  pull: Parameters<typeof pullAllDataToIndexedDB>[0];
};

export async function syncAllPending(fns: SyncFns) {
  if (!isClient() || !isBrowserOnline()) return { synced: 0, failed: 0 };

  let synced = 0;
  let failed = 0;

  const pendingSales = await getPendingSales();
  for (const sale of pendingSales) {
    await updatePendingSale(sale.id, { status: "syncing", error: undefined });
    try {
      await fns.createSale({ data: { items: sale.items, tax_rate: sale.tax_rate } });
      await removePendingSale(sale.id);
      synced += 1;
    } catch (error) {
      failed += 1;
      await updatePendingSale(sale.id, {
        status: "failed",
        error: error instanceof Error ? error.message : "Sync failed",
      });
    }
  }

  const pendingMutations = await getPendingMutations();
  for (const mutation of pendingMutations) {
    await updatePendingMutation(mutation.id, { status: "syncing", error: undefined });
    try {
      switch (mutation.type) {
        case "adjustInventory":
          await fns.adjustInventory({ data: mutation.payload });
          break;
        case "upsertProduct":
          await fns.upsertProduct({ data: mutation.payload });
          break;
        case "deleteProduct":
          await fns.deleteProduct({ data: mutation.payload });
          break;
        case "upsertCategory":
          await fns.upsertCategory({ data: mutation.payload });
          break;
        case "deleteCategory":
          await fns.deleteCategory({ data: mutation.payload });
          break;
        case "updateUserRole":
          await fns.updateUserRole({ data: mutation.payload });
          break;
        case "deleteUser":
          await fns.deleteUser({ data: mutation.payload });
          break;
        case "claimFirstAdmin":
          await fns.claimFirstAdmin();
          break;
      }
      await removePendingMutation(mutation.id);
      synced += 1;
    } catch (error) {
      failed += 1;
      await updatePendingMutation(mutation.id, {
        status: "failed",
        error: error instanceof Error ? error.message : "Sync failed",
      });
    }
  }

  if (synced > 0) {
    await pullAllDataToIndexedDB(fns.pull);
  }

  return { synced, failed };
}

export async function fullSync(fns: SyncFns) {
  if (!isClient() || !isBrowserOnline()) return { synced: 0, failed: 0 };
  const result = await syncAllPending(fns);
  try {
    await pullAllDataToIndexedDB(fns.pull);
  } catch {
    // Pull may fail for partial permissions; pending sync result still matters.
  }
  return result;
}

export { getTotalPendingCount, getPendingSales };
