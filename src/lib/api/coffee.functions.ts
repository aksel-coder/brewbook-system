import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ============ DASHBOARD ============
export const getDashboardStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const [salesAll, salesToday, products, lowStock, recent, bestSellers, last7] = await Promise.all([
      supabase.from("sales").select("total_amount"),
      supabase.from("sales").select("total_amount").gte("sale_date", today.toISOString()),
      supabase.from("products").select("id, stock_quantity, low_stock_threshold"),
      supabase.from("products").select("id, name, stock_quantity, low_stock_threshold").eq("is_active", true),
      supabase.from("sales").select("id, receipt_number, total_amount, sale_date").order("sale_date", { ascending: false }).limit(5),
      supabase.from("sale_items").select("quantity, product_id, products(name)").limit(500),
      supabase.from("sales").select("total_amount, sale_date").gte("sale_date", new Date(Date.now() - 7 * 86400000).toISOString()),
    ]);

    for (const result of [salesAll, salesToday, products, lowStock, recent, bestSellers, last7]) {
      if (result.error) throw new Error(result.error.message);
    }

    const totalSales = (salesAll.data ?? []).reduce((s, r) => s + Number(r.total_amount), 0);
    const todaySales = (salesToday.data ?? []).reduce((s, r) => s + Number(r.total_amount), 0);
    const totalProducts = products.data?.length ?? 0;
    const totalStock = (products.data ?? []).reduce((s, p) => s + (p.stock_quantity ?? 0), 0);
    const lowStockItems = (lowStock.data ?? []).filter(p => p.stock_quantity <= p.low_stock_threshold);

    // best sellers aggregation
    const bsMap = new Map<string, { name: string; qty: number }>();
    for (const row of bestSellers.data ?? []) {
      const name = (row as any).products?.name ?? "Unknown";
      const cur = bsMap.get(row.product_id) ?? { name, qty: 0 };
      cur.qty += row.quantity;
      bsMap.set(row.product_id, cur);
    }
    const best = Array.from(bsMap.values()).sort((a, b) => b.qty - a.qty).slice(0, 5);

    // sales by day (last 7)
    const dayMap = new Map<string, number>();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000);
      dayMap.set(d.toISOString().slice(0, 10), 0);
    }
    for (const r of last7.data ?? []) {
      const k = new Date(r.sale_date).toISOString().slice(0, 10);
      dayMap.set(k, (dayMap.get(k) ?? 0) + Number(r.total_amount));
    }
    const salesChart = Array.from(dayMap.entries()).map(([date, total]) => ({ date: date.slice(5), total }));

    return {
      totalSales, todaySales, totalProducts, totalStock,
      lowStockCount: lowStockItems.length,
      lowStockItems: lowStockItems.slice(0, 5),
      recent: recent.data ?? [],
      best,
      salesChart,
    };
  });

// ============ PRODUCTS ============
export const listProducts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("products")
      .select("*, categories(id, name)")
      .order("name");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const listCategories = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.from("categories").select("*").order("name");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

const productSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(120),
  description: z.string().max(1000).optional().default(""),
  category_id: z.string().uuid().nullable(),
  price: z.number().min(0),
  stock_quantity: z.number().int().min(0),
  low_stock_threshold: z.number().int().min(0).default(10),
  image_url: z.string().max(2000).optional().nullable(),
});

export const upsertProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => productSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    if (data.id) {
      const { error } = await supabase.from("products").update({ ...data, updated_at: new Date().toISOString() }).eq("id", data.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabase.from("products").insert(data);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

export const deleteProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("products").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const upsertCategory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid().optional(), name: z.string().min(1).max(80) }).parse(d))
  .handler(async ({ data, context }) => {
    if (data.id) {
      const { error } = await context.supabase.from("categories").update({ name: data.name }).eq("id", data.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await context.supabase.from("categories").insert({ name: data.name });
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

export const deleteCategory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("categories").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============ SALES ============
const saleSchema = z.object({
  items: z.array(z.object({
    product_id: z.string().uuid(),
    quantity: z.number().int().min(1),
    unit_price: z.number().min(0),
  })).min(1).max(100),
  tax_rate: z.number().min(0).max(1).default(0),
});

export const createSale = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => saleSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const subtotal = data.items.reduce((s, i) => s + i.quantity * i.unit_price, 0);
    const tax = +(subtotal * data.tax_rate).toFixed(2);
    const total = +(subtotal + tax).toFixed(2);
    const receipt = "CZ-" + Date.now().toString(36).toUpperCase();

    const { data: sale, error: se } = await supabase.from("sales").insert({
      receipt_number: receipt,
      user_id: userId,
      subtotal, tax, total_amount: total,
    }).select().single();
    if (se) throw new Error(se.message);

    const { error: ie } = await supabase.from("sale_items").insert(
      data.items.map(i => ({ sale_id: sale.id, product_id: i.product_id, quantity: i.quantity, unit_price: i.unit_price }))
    );
    if (ie) throw new Error(ie.message);

    return { sale, items: data.items, subtotal, tax, total };
  });

export const listSales = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("sales")
      .select("*, sale_items(id, quantity, unit_price, products(name))")
      .order("sale_date", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

// ============ INVENTORY ============
export const adjustInventory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    product_id: z.string().uuid(),
    quantity: z.number().int(),
    transaction_type: z.enum(["in", "out", "adjust"]),
    reference: z.string().max(200).optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: prod, error: pe } = await supabase.from("products").select("stock_quantity").eq("id", data.product_id).single();
    if (pe) throw new Error(pe.message);
    let newStock = prod.stock_quantity;
    if (data.transaction_type === "in") newStock += data.quantity;
    else if (data.transaction_type === "out") newStock -= data.quantity;
    else newStock = data.quantity;
    if (newStock < 0) throw new Error("Resulting stock cannot be negative");

    const { error: ue } = await supabase.from("products").update({ stock_quantity: newStock, updated_at: new Date().toISOString() }).eq("id", data.product_id);
    if (ue) throw new Error(ue.message);

    const { error: te } = await supabase.from("inventory_transactions").insert({
      product_id: data.product_id,
      transaction_type: data.transaction_type,
      quantity: data.transaction_type === "out" ? -Math.abs(data.quantity) : data.quantity,
      reference: data.reference ?? "manual",
      created_by: userId,
    });
    if (te) throw new Error(te.message);
    return { ok: true };
  });

export const listInventoryTxns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("inventory_transactions")
      .select("*, products(name)")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return data ?? [];
  });
