import { getAll } from "./stores";
import type {
  CachedInventoryTxn,
  CachedProduct,
  CachedSale,
  CachedSaleItem,
  DashboardStats,
} from "./types";

export async function getLocalProducts(): Promise<CachedProduct[]> {
  const products = await getAll<CachedProduct>("products");
  return products.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getLocalCategories() {
  const categories = await getAll<{ id: string; name: string; created_at: string }>("categories");
  return categories.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getLocalSalesWithItems(): Promise<CachedSale[]> {
  const [sales, items, products] = await Promise.all([
    getAll<CachedSale>("sales"),
    getAll<CachedSaleItem>("sale_items"),
    getAll<CachedProduct>("products"),
  ]);

  const productMap = new Map(products.map((p) => [p.id, p.name]));
  const itemsBySale = new Map<string, CachedSaleItem[]>();

  for (const item of items) {
    const list = itemsBySale.get(item.sale_id) ?? [];
    list.push({
      ...item,
      products: { name: productMap.get(item.product_id) ?? item.products?.name ?? "Unknown" },
    });
    itemsBySale.set(item.sale_id, list);
  }

  return sales
    .map((sale) => ({
      ...sale,
      sale_items: itemsBySale.get(sale.id) ?? [],
    }))
    .sort((a, b) => b.sale_date.localeCompare(a.sale_date));
}

export async function getLocalInventoryTxns(): Promise<CachedInventoryTxn[]> {
  const [txns, products] = await Promise.all([
    getAll<CachedInventoryTxn>("inventory_transactions"),
    getAll<CachedProduct>("products"),
  ]);
  const productMap = new Map(products.map((p) => [p.id, p.name]));

  return txns
    .map((txn) => ({
      ...txn,
      products: { name: productMap.get(txn.product_id) ?? txn.products?.name ?? "Unknown" },
    }))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function getLocalUsers() {
  const users = await getAll<{
    id: string;
    full_name: string;
    username: string | null;
    email: string;
    roles: string[];
    created_at: string;
  }>("users");
  return users.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function computeLocalDashboard(): Promise<DashboardStats> {
  const [products, sales] = await Promise.all([getLocalProducts(), getLocalSalesWithItems()]);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const totalSales = sales.reduce((sum, s) => sum + Number(s.total_amount), 0);
  const todaySales = sales
    .filter((s) => new Date(s.sale_date) >= today)
    .reduce((sum, s) => sum + Number(s.total_amount), 0);
  const totalProducts = products.length;
  const totalStock = products.reduce((sum, p) => sum + (p.stock_quantity ?? 0), 0);
  const lowStockItems = products
    .filter((p) => p.is_active && p.stock_quantity <= p.low_stock_threshold)
    .map((p) => ({
      id: p.id,
      name: p.name,
      stock_quantity: p.stock_quantity,
      low_stock_threshold: p.low_stock_threshold,
    }));

  const bsMap = new Map<string, { name: string; qty: number }>();
  for (const sale of sales) {
    for (const item of sale.sale_items ?? []) {
      const name = item.products?.name ?? "Unknown";
      const cur = bsMap.get(item.product_id) ?? { name, qty: 0 };
      cur.qty += item.quantity;
      bsMap.set(item.product_id, cur);
    }
  }
  const best = Array.from(bsMap.values()).sort((a, b) => b.qty - a.qty).slice(0, 5);

  const dayMap = new Map<string, number>();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    dayMap.set(d.toISOString().slice(0, 10), 0);
  }
  for (const sale of sales) {
    const k = new Date(sale.sale_date).toISOString().slice(0, 10);
    if (dayMap.has(k)) dayMap.set(k, (dayMap.get(k) ?? 0) + Number(sale.total_amount));
  }
  const salesChart = Array.from(dayMap.entries()).map(([date, total]) => ({
    date: date.slice(5),
    total,
  }));

  return {
    totalSales,
    todaySales,
    totalProducts,
    totalStock,
    lowStockCount: lowStockItems.length,
    lowStockItems: lowStockItems.slice(0, 5),
    recent: sales.slice(0, 5).map((s) => ({
      id: s.id,
      receipt_number: s.receipt_number,
      total_amount: s.total_amount,
      sale_date: s.sale_date,
    })),
    best,
    salesChart,
  };
}
