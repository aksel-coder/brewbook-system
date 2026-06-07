import {
  applyCategoryDeleteLocally,
  applyCategoryUpsertLocally,
  applyInventoryAdjustLocally,
  applyProductDeleteLocally,
  applyProductUpsertLocally,
  addPendingMutation,
} from "./mutations";
import {
  applyLocalStockDeductions,
  addPendingSale,
  calcSaleTotals,
  getPendingSales,
  getPendingSalesCount,
  removePendingSale,
  updatePendingSale,
} from "./sales";
import {
  computeLocalDashboard,
  getLocalCategories,
  getLocalInventoryTxns,
  getLocalProducts,
  getLocalSalesWithItems,
  getLocalUsers,
} from "./local-data";
import { getSession, saveSession } from "./session";
import { pullAllDataToIndexedDB } from "./pull";
import { put, remove, replaceAll } from "./stores";
import type { CachedProduct, CheckoutResult, SaleItemInput } from "./types";

const SERVER_TIMEOUT_MS = 8_000;

export function isClient() {
  return typeof window !== "undefined";
}

export function isBrowserOnline() {
  return isClient() && navigator.onLine;
}

export function shouldUseLocalData() {
  // Only skip the server when the browser reports offline.
  // A stale offline-auth flag must not block live Supabase reads while online.
  return isClient() && !navigator.onLine;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("Request timed out")), ms),
    ),
  ]);
}

async function tryOnline<T>(fn: () => Promise<T>, fallback: () => Promise<T>): Promise<T> {
  if (!isClient()) {
    try {
      return await withTimeout(fn(), SERVER_TIMEOUT_MS);
    } catch {
      return fallback();
    }
  }

  if (shouldUseLocalData()) return fallback();

  try {
    return await withTimeout(fn(), SERVER_TIMEOUT_MS);
  } catch (error) {
    if (shouldFallbackToOffline(error)) return fallback();
    throw error;
  }
}

function shouldFallbackToOffline(error: unknown) {
  if (!isBrowserOnline()) return true;
  if (error instanceof TypeError) return true;
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes("fetch")
      || message.includes("network")
      || message.includes("failed to fetch")
      || message.includes("unauthorized")
      || message.includes("timed out")
      || message.includes("missing supabase")
    );
  }
  return false;
}

function normalizeProduct(raw: any): CachedProduct {
  return {
    id: raw.id,
    name: raw.name,
    description: raw.description ?? null,
    category_id: raw.category_id ?? null,
    price: Number(raw.price),
    cost: Number(raw.cost),
    stock_quantity: raw.stock_quantity,
    low_stock_threshold: raw.low_stock_threshold,
    image_url: raw.image_url ?? null,
    is_active: raw.is_active,
    categories: raw.categories ?? null,
    cached_at: new Date().toISOString(),
  };
}

export async function syncPullAll(fns: Parameters<typeof pullAllDataToIndexedDB>[0]) {
  if (!isClient() || !isBrowserOnline()) return;
  await pullAllDataToIndexedDB(fns);
}

export async function loadProducts(listFn: () => Promise<unknown[]>) {
  return tryOnline(async () => {
    const data = await listFn();
    await replaceAll("products", (data as any[]).map(normalizeProduct));
    return data;
  }, getLocalProducts);
}

export async function loadCategories(listFn: () => Promise<unknown[]>) {
  return tryOnline(async () => {
    const data = await listFn();
    await replaceAll(
      "categories",
      (data as any[]).map((c) => ({ id: c.id, name: c.name, created_at: c.created_at })),
    );
    return data;
  }, getLocalCategories);
}

export async function loadSales(listFn: () => Promise<unknown[]>) {
  return tryOnline(async () => {
    const data = await listFn();
    const sales: any[] = [];
    const items: any[] = [];
    for (const sale of data as any[]) {
      sales.push({
        id: sale.id,
        receipt_number: sale.receipt_number,
        user_id: sale.user_id,
        subtotal: Number(sale.subtotal),
        tax: Number(sale.tax),
        total_amount: Number(sale.total_amount),
        sale_date: sale.sale_date,
        synced: true,
      });
      for (const item of sale.sale_items ?? []) {
        items.push({
          id: item.id,
          sale_id: sale.id,
          product_id: item.product_id,
          quantity: item.quantity,
          unit_price: Number(item.unit_price),
          created_at: item.created_at ?? sale.sale_date,
          products: item.products ?? null,
        });
      }
    }
    await replaceAll("sales", sales);
    await replaceAll("sale_items", items);
    return getLocalSalesWithItems();
  }, getLocalSalesWithItems);
}

export async function loadInventoryTxns(listFn: () => Promise<unknown[]>) {
  return tryOnline(async () => {
    const data = await listFn();
    await replaceAll(
      "inventory_transactions",
      (data as any[]).map((t) => ({
        id: t.id,
        product_id: t.product_id,
        transaction_type: t.transaction_type,
        quantity: t.quantity,
        reference: t.reference ?? null,
        created_by: t.created_by ?? null,
        created_at: t.created_at,
        products: t.products ?? null,
      })),
    );
    return getLocalInventoryTxns();
  }, getLocalInventoryTxns);
}

export async function loadDashboard(statsFn: () => Promise<unknown>) {
  if (shouldUseLocalData()) return computeLocalDashboard();
  try {
    return await withTimeout(statsFn(), SERVER_TIMEOUT_MS);
  } catch (error) {
    try {
      return await computeLocalDashboard();
    } catch {
      throw error;
    }
  }
}

export async function loadUsers(listFn: () => Promise<unknown[]>) {
  return tryOnline(async () => {
    const data = await listFn();
    await replaceAll(
      "users",
      (data as any[]).map((u) => ({
        id: u.id,
        full_name: u.full_name,
        username: u.username ?? null,
        email: u.email ?? "",
        roles: u.roles ?? ["cashier"],
        created_at: u.created_at,
      })),
    );
    return data;
  }, getLocalUsers);
}

export async function loadMyRole(roleFn: () => Promise<unknown>) {
  return tryOnline(roleFn, async () => {
    const session = await getSession();
    if (!session) throw new Error("No cached session. Sign in while online first.");
    return {
      userId: session.userId,
      isAdmin: session.isAdmin,
      role: session.role,
      fullName: session.fullName,
      username: session.username,
    };
  });
}

export async function checkoutSale(
  createSaleFn: (input: { data: { items: SaleItemInput[]; tax_rate: number } }) => Promise<{
    sale: { id: string; receipt_number: string };
    items: SaleItemInput[];
    subtotal: number;
    tax: number;
    total: number;
  }>,
  input: { items: SaleItemInput[]; tax_rate: number },
): Promise<CheckoutResult> {
  const { subtotal, tax, total } = calcSaleTotals(input.items, input.tax_rate);

  if (!isClient()) {
    const result = await createSaleFn({ data: input });
    return { ...result, offline: false };
  }

  if (!shouldUseLocalData()) {
    try {
      const result = await withTimeout(createSaleFn({ data: input }), SERVER_TIMEOUT_MS);
      return { ...result, offline: false };
    } catch (error) {
      if (!shouldFallbackToOffline(error)) throw error;
    }
  }

  const pending = await addPendingSale(input);
  await applyLocalStockDeductions(input.items);

  return {
    sale: { id: pending.id, receipt_number: pending.receipt_number },
    items: input.items,
    subtotal,
    tax,
    total,
    offline: true,
  };
}

export async function mutateInventory(
  serverFn: (input: { data: Record<string, unknown> }) => Promise<unknown>,
  data: Record<string, unknown>,
) {
  const session = await getSession();
  return tryOnline(
    () => serverFn({ data }),
    async () => {
      await applyInventoryAdjustLocally({
        product_id: data.product_id as string,
        quantity: Number(data.quantity),
        transaction_type: data.transaction_type as "in" | "out" | "adjust",
        reference: data.reference as string | undefined,
        userId: session?.userId,
      });
      await addPendingMutation("adjustInventory", data);
      return { ok: true, offline: true };
    },
  );
}

export async function mutateProduct(
  serverFn: (input: { data: Record<string, unknown> }) => Promise<unknown>,
  data: Record<string, unknown>,
  mode: "upsert" | "delete",
) {
  return tryOnline(
    () => serverFn({ data }),
    async () => {
      if (mode === "delete") {
        await applyProductDeleteLocally(data.id as string);
        await addPendingMutation("deleteProduct", data);
      } else {
        await applyProductUpsertLocally(data);
        await addPendingMutation("upsertProduct", data);
      }
      return { ok: true, offline: true };
    },
  );
}

export async function mutateCategory(
  serverFn: (input: { data: Record<string, unknown> }) => Promise<unknown>,
  data: Record<string, unknown>,
  mode: "upsert" | "delete",
) {
  return tryOnline(
    () => serverFn({ data }),
    async () => {
      if (mode === "delete") {
        await applyCategoryDeleteLocally(data.id as string);
        await addPendingMutation("deleteCategory", data);
      } else {
        await applyCategoryUpsertLocally(data as { id?: string; name: string });
        await addPendingMutation("upsertCategory", data);
      }
      return { ok: true, offline: true };
    },
  );
}

export async function mutateUserRole(
  serverFn: (input: { data: Record<string, unknown> }) => Promise<unknown>,
  data: Record<string, unknown>,
) {
  if (shouldUseLocalData()) {
    await addPendingMutation("updateUserRole", data);
    const users = await getLocalUsers();
    const user = users.find((u) => u.id === data.user_id);
    if (user) await put("users", { ...user, roles: [data.role as string] });
    return { ok: true, offline: true };
  }
  return serverFn({ data });
}

export async function mutateDeleteUser(
  serverFn: (input: { data: Record<string, unknown> }) => Promise<unknown>,
  data: Record<string, unknown>,
) {
  if (shouldUseLocalData()) {
    await addPendingMutation("deleteUser", data);
    await remove("users", data.user_id as string);
    return { ok: true, offline: true };
  }
  return serverFn({ data });
}

export async function mutateClaimAdmin(serverFn: () => Promise<unknown>) {
  if (shouldUseLocalData()) {
    await addPendingMutation("claimFirstAdmin", {});
    const session = await getSession();
    if (session) await saveSession({ ...session, isAdmin: true, role: "admin" });
    return { ok: true, offline: true };
  }
  return serverFn();
}

export {
  getPendingSales,
  getPendingSalesCount,
  removePendingSale,
  updatePendingSale,
  pullAllDataToIndexedDB,
  getSession,
  saveSession,
};
