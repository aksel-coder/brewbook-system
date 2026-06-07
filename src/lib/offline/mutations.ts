import { getAll, put, remove } from "./stores";
import { withStore } from "./db";
import type { CachedProduct, PendingMutation, PendingMutationType } from "./types";

export async function addPendingMutation(type: PendingMutationType, payload: Record<string, unknown>) {
  const mutation: PendingMutation = {
    id: crypto.randomUUID(),
    type,
    payload,
    created_at: new Date().toISOString(),
    status: "pending",
  };
  await put("pendingMutations", mutation);
  return mutation;
}

export async function getPendingMutations() {
  const all = await getAll<PendingMutation>("pendingMutations");
  return all
    .filter((m) => m.status === "pending" || m.status === "failed")
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export async function getPendingMutationsCount() {
  return (await getPendingMutations()).length;
}

export async function getTotalPendingCount() {
  const [sales, mutations] = await Promise.all([
    withStore<unknown[]>("pendingSales", "readonly", (s) => s.getAll()).then((items: any[]) =>
      items.filter((i) => i.status === "pending" || i.status === "failed").length,
    ),
    getPendingMutationsCount(),
  ]);
  return sales + mutations;
}

export async function updatePendingMutation(id: string, patch: Partial<Pick<PendingMutation, "status" | "error">>) {
  const all = await getAll<PendingMutation>("pendingMutations");
  const existing = all.find((m) => m.id === id);
  if (!existing) return;
  await put("pendingMutations", { ...existing, ...patch });
}

export async function removePendingMutation(id: string) {
  await remove("pendingMutations", id);
}

export async function applyProductUpsertLocally(data: Record<string, unknown>) {
  const products = await getAll<CachedProduct>("products");
  const categories = await getAll<{ id: string; name: string }>("categories");
  const category = categories.find((c) => c.id === data.category_id);

  const existing = data.id ? products.find((p) => p.id === data.id) : undefined;
  const id = (data.id as string) || crypto.randomUUID();
  const next: CachedProduct = {
    id,
    name: String(data.name),
    description: (data.description as string) ?? "",
    category_id: (data.category_id as string) ?? null,
    price: Number(data.price),
    cost: Number(data.cost),
    stock_quantity: Number(data.stock_quantity),
    low_stock_threshold: Number(data.low_stock_threshold ?? 10),
    image_url: (data.image_url as string) ?? null,
    is_active: existing?.is_active ?? true,
    categories: category ? { id: category.id, name: category.name, created_at: "" } : null,
    cached_at: new Date().toISOString(),
  };
  await put("products", next);
}

export async function applyProductDeleteLocally(id: string) {
  await remove("products", id);
}

export async function applyCategoryUpsertLocally(data: { id?: string; name: string }) {
  const id = data.id || crypto.randomUUID();
  await put("categories", { id, name: data.name, created_at: new Date().toISOString() });
}

export async function applyCategoryDeleteLocally(id: string) {
  await remove("categories", id);
}

export async function applyInventoryAdjustLocally(input: {
  product_id: string;
  quantity: number;
  transaction_type: "in" | "out" | "adjust";
  reference?: string;
  userId?: string;
}) {
  const products = await getAll<CachedProduct>("products");
  const product = products.find((p) => p.id === input.product_id);
  if (!product) throw new Error("Product not found in local cache");

  let newStock = product.stock_quantity;
  if (input.transaction_type === "in") newStock += input.quantity;
  else if (input.transaction_type === "out") newStock -= input.quantity;
  else newStock = input.quantity;
  if (newStock < 0) throw new Error("Resulting stock cannot be negative");

  await put("products", { ...product, stock_quantity: newStock, cached_at: new Date().toISOString() });
  await put("inventory_transactions", {
    id: crypto.randomUUID(),
    product_id: input.product_id,
    transaction_type: input.transaction_type,
    quantity: input.transaction_type === "out" ? -Math.abs(input.quantity) : input.quantity,
    reference: input.reference ?? "manual",
    created_by: input.userId ?? null,
    created_at: new Date().toISOString(),
    products: { name: product.name },
  });
}
