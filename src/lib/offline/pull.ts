import { getAll, replaceAll, setMeta } from "./stores";
import { saveSession } from "./session";
import { enrichCredentialFromSession } from "./credentials";
import { getPendingSales } from "./sales";
import type { CachedInventoryTxn, CachedProduct, CachedSale, CachedSaleItem } from "./types";

type PullFns = {
  listProducts: () => Promise<unknown[]>;
  listCategories: () => Promise<unknown[]>;
  listSales: () => Promise<unknown[]>;
  listInventoryTxns: () => Promise<unknown[]>;
  getMyRole: () => Promise<{
    userId: string;
    isAdmin: boolean;
    role: "admin" | "cashier";
    fullName: string;
    username: string;
  }>;
  listUsers?: () => Promise<unknown[]>;
  getUserEmail?: () => string | null;
};

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
    created_at: raw.created_at,
    updated_at: raw.updated_at,
    cached_at: new Date().toISOString(),
  };
}

export async function pullAllDataToIndexedDB(fns: PullFns) {
  const [products, categories, sales, txns, me] = await Promise.all([
    fns.listProducts(),
    fns.listCategories(),
    fns.listSales(),
    fns.listInventoryTxns(),
    fns.getMyRole(),
  ]);

  const normalizedProducts = (products as any[]).map(normalizeProduct);
  const normalizedCategories = (categories as any[]).map((c) => ({
    id: c.id,
    name: c.name,
    created_at: c.created_at,
  }));

  const normalizedSales: CachedSale[] = [];
  const normalizedItems: CachedSaleItem[] = [];

  for (const sale of sales as any[]) {
    normalizedSales.push({
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
      normalizedItems.push({
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

  const normalizedTxns: CachedInventoryTxn[] = (txns as any[]).map((t) => ({
    id: t.id,
    product_id: t.product_id,
    transaction_type: t.transaction_type,
    quantity: t.quantity,
    reference: t.reference ?? null,
    created_by: t.created_by ?? null,
    created_at: t.created_at,
    products: t.products ?? null,
  }));

  const pending = await getPendingSales();
  const pendingIds = new Set(pending.map((s) => s.id));
  const [existingSales, existingItems] = await Promise.all([
    getAll<CachedSale>("sales"),
    getAll<CachedSaleItem>("sale_items"),
  ]);
  const offlineSales = existingSales.filter((s) => s.offline && pendingIds.has(s.id));
  const offlineSaleIds = new Set(offlineSales.map((s) => s.id));
  const offlineItems = existingItems.filter((i) => offlineSaleIds.has(i.sale_id));

  await Promise.all([
    replaceAll("products", normalizedProducts),
    replaceAll("categories", normalizedCategories),
    replaceAll("sales", [...normalizedSales, ...offlineSales]),
    replaceAll("sale_items", [...normalizedItems, ...offlineItems]),
    replaceAll("inventory_transactions", normalizedTxns),
  ]);

  await saveSession({
    userId: me.userId,
    email: fns.getUserEmail?.() ?? "",
    isAdmin: me.isAdmin,
    role: me.role,
    fullName: me.fullName,
    username: me.username,
  });

  if (fns.listUsers) {
    try {
      const users = (await fns.listUsers()) as any[];
      await replaceAll(
        "users",
        users.map((u) => ({
          id: u.id,
          full_name: u.full_name,
          username: u.username ?? null,
          email: u.email ?? "",
          roles: u.roles ?? ["cashier"],
          created_at: u.created_at,
        })),
      );
    } catch {
      // Cashiers cannot list users — keep existing cache.
    }
  }

  await setMeta("lastFullSyncAt", new Date().toISOString());
  await enrichCredentialFromSession();
}
