import { getAll, put, remove as removeFromStore } from "./stores";
import { withStore } from "./db";
import { getSession } from "./session";
import { getAll } from "./stores";
import type { CachedProduct, PendingSale, SaleItemInput } from "./types";

export function makeOfflineReceiptNumber() {
  return `CZ-OFF-${Date.now().toString(36).toUpperCase()}`;
}

export function calcSaleTotals(items: SaleItemInput[], taxRate: number) {
  const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0);
  const tax = +(subtotal * taxRate).toFixed(2);
  const total = +(subtotal + tax).toFixed(2);
  return { subtotal, tax, total };
}

export async function addPendingSale(input: {
  items: SaleItemInput[];
  tax_rate: number;
}): Promise<PendingSale> {
  const { subtotal, tax, total } = calcSaleTotals(input.items, input.tax_rate);
  const saleId = crypto.randomUUID();
  const session = await getSession();

  const sale: PendingSale = {
    id: saleId,
    items: input.items,
    tax_rate: input.tax_rate,
    subtotal,
    tax,
    total,
    receipt_number: makeOfflineReceiptNumber(),
    created_at: new Date().toISOString(),
    status: "pending",
  };

  await withStore("pendingSales", "readwrite", (store) => store.add(sale));

  await put("sales", {
    id: saleId,
    receipt_number: sale.receipt_number,
    user_id: session?.userId ?? "offline",
    subtotal,
    tax,
    total_amount: total,
    sale_date: sale.created_at,
    offline: true,
    synced: false,
  });

  const products = await getAll<CachedProduct>("products");
  const productMap = new Map(products.map((p) => [p.id, p.name]));

  for (const item of input.items) {
    await put("sale_items", {
      id: crypto.randomUUID(),
      sale_id: saleId,
      product_id: item.product_id,
      quantity: item.quantity,
      unit_price: item.unit_price,
      created_at: sale.created_at,
      products: { name: productMap.get(item.product_id) ?? "Unknown" },
    });
  }

  return sale;
}

export async function getPendingSales(): Promise<PendingSale[]> {
  const sales = await withStore<PendingSale[]>("pendingSales", "readonly", (store) => store.getAll());
  return sales
    .filter((sale) => sale.status === "pending" || sale.status === "failed")
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function getPendingSalesCount(): Promise<number> {
  return (await getPendingSales()).length;
}

export async function updatePendingSale(
  id: string,
  patch: Partial<Pick<PendingSale, "status" | "error">>,
): Promise<void> {
  const existing = await withStore<PendingSale | undefined>("pendingSales", "readonly", (store) => store.get(id));
  if (!existing) return;

  await withStore("pendingSales", "readwrite", (store) =>
    store.put({ ...existing, ...patch }),
  );
}

export async function removePendingSale(id: string): Promise<void> {
  await withStore("pendingSales", "readwrite", (store) => store.delete(id));
  await removeFromStore("sales", id);
  const items = await getAll<{ id: string; sale_id: string }>("sale_items");
  for (const item of items.filter((i) => i.sale_id === id)) {
    await removeFromStore("sale_items", item.id);
  }
}

export async function applyLocalStockDeductions(items: { product_id: string; quantity: number }[]) {
  const products = await getAll<CachedProduct>("products");
  const session = await getSession();

  for (const item of items) {
    const product = products.find((p) => p.id === item.product_id);
    if (!product) throw new Error(`Cached product not found: ${item.product_id}`);

    const nextStock = Math.max(0, product.stock_quantity - item.quantity);
    await put("products", { ...product, stock_quantity: nextStock, cached_at: new Date().toISOString() });
    await put("inventory_transactions", {
      id: crypto.randomUUID(),
      product_id: item.product_id,
      transaction_type: "sale",
      quantity: -item.quantity,
      reference: "offline-sale",
      created_by: session?.userId ?? null,
      created_at: new Date().toISOString(),
      products: { name: product.name },
    });
  }
}
