import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const isCompletedSale = (sale: any) => {
  const status = sale?.status ?? sale?.sale_status ?? sale?.state;
  if (status == null) return true;
  return String(status).toLowerCase() === "completed";
};

async function requireAdminRole(supabase: any, userId: string, action: string) {
  const { data, error } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  if (error) throw new Error(error.message);

  const isAdmin = (data ?? []).some((row: any) => String(row.role ?? "").toLowerCase() === "admin");
  if (!isAdmin) throw new Error(`Forbidden: admin access required for ${action}`);
}

async function requireInventoryWriteAccess(supabase: any, userId: string) {
  await requireAdminRole(supabase, userId, "inventory updates");
}

const enrichProductsWithSales = (products: any[], salesRows: any[]) => {
  const soldByProduct = new Map<string, number>();
  for (const sale of salesRows ?? []) {
    if (!isCompletedSale(sale)) continue;
    for (const item of sale.sale_items ?? []) {
      const productId = item?.product_id;
      if (!productId) continue;
      soldByProduct.set(productId, (soldByProduct.get(productId) ?? 0) + Number(item.quantity ?? 0));
    }
  }

  return (products ?? []).map((product) => ({
    ...product,
    sold_quantity: soldByProduct.get(product.id) ?? 0,
  }));
};

// ============ DASHBOARD ============
export const getDashboardStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    startDate: z.string().datetime(),
    endDate: z.string().datetime(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const salesInRangePromise = (async () => {
      const all: any[] = [];
      for (let from = 0; ; from += 1000) {
        const result = await supabase.from("sales")
          .select("id, total_amount, sale_date, sale_items(quantity, product_id, unit_price, products(name, price))")
          .gte("sale_date", data.startDate)
          .lte("sale_date", data.endDate)
          .range(from, from + 999);
        if (result.error) throw new Error(result.error.message);
        all.push(...(result.data ?? []));
        if ((result.data?.length ?? 0) < 1000) break;
      }
      return { data: all, error: null };
    })();
    const [salesInRange, salesToday, products, recent, completedSales] = await Promise.all([
      salesInRangePromise,
      supabase.from("sales").select("id, total_amount").gte("sale_date", today.toISOString()),
      supabase.from("products").select("id, name, stock_quantity, low_stock_threshold").eq("is_active", true),
      supabase.from("sales").select("id, receipt_number, total_amount, sale_date").gte("sale_date", data.startDate).lte("sale_date", data.endDate).order("sale_date", { ascending: false }).limit(5),
      supabase.from("sales").select("id, sale_items(quantity, product_id)").order("sale_date", { ascending: false }),
    ]);

    for (const result of [salesInRange, salesToday, products, recent, completedSales]) {
      if (result.error) throw new Error(result.error.message);
    }

    const totalSales = (salesInRange.data ?? []).reduce((s, r) => s + Number(r.total_amount), 0);
    const todaySales = (salesToday.data ?? []).reduce((s, r) => s + Number(r.total_amount), 0);
    const orderCount = salesInRange.data?.length ?? 0;
    const productsWithSales = enrichProductsWithSales(products.data ?? [], completedSales.data ?? []);
    const totalProducts = productsWithSales.length;
    const totalStock = productsWithSales.reduce((s, p) => s + (p.stock_quantity ?? 0), 0);
    const lowStockItems = productsWithSales.filter((p: any) => (p.stock_quantity ?? 0) <= (p.low_stock_threshold ?? 0));

    // best sellers aggregation
    const bsMap = new Map<string, { name: string; qty: number; price: number }>();
    for (const sale of salesInRange.data ?? []) {
      for (const row of sale.sale_items ?? []) {
        const name = row.products?.name ?? "Unknown";
        const price = Number(row.products?.price ?? row.unit_price ?? 0);
        const cur = bsMap.get(row.product_id) ?? { name, qty: 0, price };
        cur.qty += Number(row.quantity ?? 0);
        if (price > 0) cur.price = price;
        bsMap.set(row.product_id, cur);
      }
    }
    const best = Array.from(bsMap.values()).sort((a, b) => b.qty - a.qty).slice(0, 5);

    const dayMap = new Map<string, number>();
    const startDay = new Date(data.startDate);
    const endDay = new Date(data.endDate);
    for (const cursor = new Date(startDay); cursor <= endDay; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
      dayMap.set(cursor.toISOString().slice(0, 10), 0);
    }
    for (const r of salesInRange.data ?? []) {
      const k = new Date(r.sale_date).toISOString().slice(0, 10);
      dayMap.set(k, (dayMap.get(k) ?? 0) + Number(r.total_amount));
    }
    const salesChart = Array.from(dayMap.entries()).map(([date, total]) => ({ date: date.slice(5), total }));

    return {
      totalSales,
      todaySales,
      orderCount,
      totalProducts,
      totalStock,
      lowStockCount: lowStockItems.length,
      lowStockItems: lowStockItems.slice(0, 5),
      recent: recent.data ?? [],
      best,
      topItem: best[0] ?? null,
      topSeller: best[0] ?? null,
      todayOrders: orderCount,
      salesChart,
    };
  });

// ============ PRODUCTS ============
export const listProducts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const [productsResult, salesResult, recipesResult] = await Promise.all([
      context.supabase.from("products").select("*, categories(id, name)").order("name"),
      context.supabase.from("sales").select("id, sale_items(quantity, product_id)").order("sale_date", { ascending: false }),
      context.supabase.from("product_recipes").select("product_id, quantity_required, inventory_items(current_stock)"),
    ]);

    if (productsResult.error) throw new Error(productsResult.error.message);
    if (salesResult.error) throw new Error(salesResult.error.message);
    if (recipesResult.error) throw new Error(recipesResult.error.message);

    const recipesByProduct = new Map<string, any[]>();
    for (const recipe of recipesResult.data ?? []) {
      const current = recipesByProduct.get(recipe.product_id) ?? [];
      current.push(recipe);
      recipesByProduct.set(recipe.product_id, current);
    }

    return enrichProductsWithSales(productsResult.data ?? [], salesResult.data ?? []).map((product) => {
      const recipes = recipesByProduct.get(product.id);
      const availableStock = recipes?.length
        ? Math.min(...recipes.map((recipe) => Math.floor(Number(recipe.inventory_items?.current_stock ?? 0) / Number(recipe.quantity_required))))
        : Number(product.stock_quantity ?? 0);
      return { ...product, available_stock: Math.max(0, availableStock) };
    });
  });

export const listCategories = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.from("categories").select("*").order("name");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const listInventoryItems = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.from("inventory_items").select("*").order("name");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const upsertInventoryItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    id: z.string().uuid().optional(),
    name: z.string().min(1).max(120),
    unit: z.enum(["g", "ml", "pcs", "oz"]),
    initial_stock: z.number().min(0),
    low_stock_threshold: z.number().min(0),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdminRole(context.supabase, context.userId, "ingredient management");
    const payload = data.id
      ? { name: data.name, unit: data.unit, low_stock_threshold: data.low_stock_threshold }
      : { ...data, current_stock: data.initial_stock };
    const result = data.id
      ? await context.supabase.from("inventory_items").update(payload).eq("id", data.id)
      : await context.supabase.from("inventory_items").insert(payload);
    if (result.error) throw new Error(result.error.message);
    return { ok: true };
  });

export const deleteInventoryItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdminRole(context.supabase, context.userId, "ingredient deletion");
    const { error } = await context.supabase.from("inventory_items").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listProductRecipes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ product_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: recipes, error } = await context.supabase
      .from("product_recipes").select("item_id, quantity_required, inventory_items(id, name, unit)").eq("product_id", data.product_id);
    if (error) throw new Error(error.message);
    return recipes ?? [];
  });

export const listAllProductRecipes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("product_recipes")
      .select("product_id, item_id, quantity_required, inventory_items(name, unit)");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

const productSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(120),
  description: z.string().max(1000).optional().default(""),
  category_id: z.string().uuid().nullable(),
  price: z.number().min(0),
  stock_quantity: z.preprocess(
    (value) => value == null || value === "" || (typeof value === "number" && (!Number.isFinite(value) || value < 0)) ? 0 : value,
    z.number().int().min(0).default(0),
  ),
  low_stock_threshold: z.number().int().min(0).default(10),
  image_url: z.string().max(2000).optional().nullable(),
  recipes: z.array(z.object({ item_id: z.string().uuid(), quantity_required: z.number().positive() })).default([]),
});

export const upsertProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => productSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requireAdminRole(supabase, userId, "product management");

    const { recipes, ...productData } = data;
    let productId = data.id;

    if (data.id) {
      const { error } = await supabase.from("products").update({ ...productData, updated_at: new Date().toISOString() }).eq("id", data.id);
      if (error) throw new Error(error.message);
    } else {
      const { data: product, error } = await supabase.from("products").insert(productData).select("id").single();
      if (error) throw new Error(error.message);
      productId = product.id;
    }

    if (!productId) throw new Error("Product id was not returned");
    const { error: deleteRecipesError } = await supabase.from("product_recipes").delete().eq("product_id", productId);
    if (deleteRecipesError) throw new Error(deleteRecipesError.message);
    if (recipes.length > 0) {
      const { error: recipeError } = await supabase.from("product_recipes").insert(
        recipes.map((recipe) => ({ ...recipe, product_id: productId }))
      );
      if (recipeError) throw new Error(recipeError.message);
    }
    return { ok: true };
  });

export const deleteProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdminRole(context.supabase, context.userId, "product deletion");
    const { error } = await context.supabase.from("products").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const upsertCategory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid().optional(), name: z.string().min(1).max(80) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdminRole(context.supabase, context.userId, "category management");

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
    await requireAdminRole(context.supabase, context.userId, "category deletion");
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
    const tax = 0;
    const total = subtotal;
    const receipt = "CZ-" + Date.now().toString(36).toUpperCase();

    const productIds = [...new Set(data.items.map((item) => item.product_id))];
    const { data: productsData, error: productLookupError } = await supabase
      .from("products")
      .select("id, name, stock_quantity")
      .in("id", productIds);
    if (productLookupError) throw new Error(productLookupError.message);

      const { data: recipesData, error: recipesError } = await supabase
        .from("product_recipes").select("product_id").in("product_id", productIds);
      if (recipesError) throw new Error(recipesError.message);
      const recipeProductIds = new Set((recipesData ?? []).map((recipe) => recipe.product_id));

    const productMap = new Map((productsData ?? []).map((product) => [product.id, product]));
    for (const item of data.items) {
      const current = productMap.get(item.product_id);
      if (!current) throw new Error("Product not found");
        if (!recipeProductIds.has(item.product_id) && Number(current.stock_quantity ?? 0) < item.quantity) {
        throw new Error(`${current.name} has insufficient stock`);
      }
    }

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

    for (const item of data.items) {
      const { data: recipeRows, error: recipeLookupError } = await supabase
        .from("product_recipes")
        .select("item_id, quantity_required")
        .eq("product_id", item.product_id);

      if (recipeLookupError) {
        await supabase.from("sale_items").delete().eq("sale_id", sale.id);
        await supabase.from("sales").delete().eq("id", sale.id);
        throw new Error(recipeLookupError.message);
      }

      const recipes = recipeRows ?? [];
      if (recipes.length > 0) {
        for (const recipe of recipes) {
          const required = Number(recipe.quantity_required ?? 0) * item.quantity;
          const { data: inventoryRow, error: inventoryReadError } = await supabase
            .from("inventory_items")
            .select("id, name, current_stock, total_used")
            .eq("id", recipe.item_id)
            .single();

          if (inventoryReadError) {
            await supabase.from("sale_items").delete().eq("sale_id", sale.id);
            await supabase.from("sales").delete().eq("id", sale.id);
            throw new Error(inventoryReadError.message);
          }

          const currentStock = Number(inventoryRow?.current_stock ?? 0);
          if (currentStock < required) {
            await supabase.from("sale_items").delete().eq("sale_id", sale.id);
            await supabase.from("sales").delete().eq("id", sale.id);
            throw new Error(`Insufficient ingredient stock for ${inventoryRow?.name ?? "recipe ingredient"}`);
          }

          const nextStock = currentStock - required;
          const nextUsed = Number(inventoryRow?.total_used ?? 0) + required;
          const { error: itemUpdateError } = await supabase
            .from("inventory_items")
            .update({ current_stock: nextStock, total_used: nextUsed })
            .eq("id", recipe.item_id);

          if (itemUpdateError) {
            await supabase.from("sale_items").delete().eq("sale_id", sale.id);
            await supabase.from("sales").delete().eq("id", sale.id);
            throw new Error(itemUpdateError.message);
          }

          const { error: movementError } = await supabase.from("inventory_movements").insert({
            item_id: recipe.item_id,
            type: "Sale",
            qty: -required,
            reference: receipt,
          });

          if (movementError) {
            await supabase.from("sale_items").delete().eq("sale_id", sale.id);
            await supabase.from("sales").delete().eq("id", sale.id);
            throw new Error(movementError.message);
          }
        }
        continue;
      }

      const current = productMap.get(item.product_id);
      if (!current) {
        await supabase.from("sale_items").delete().eq("sale_id", sale.id);
        await supabase.from("sales").delete().eq("id", sale.id);
        throw new Error("Product not found");
      }

      if (Number(current.stock_quantity ?? 0) < item.quantity) {
        await supabase.from("sale_items").delete().eq("sale_id", sale.id);
        await supabase.from("sales").delete().eq("id", sale.id);
        throw new Error(`${current.name} has insufficient stock`);
      }

      const nextProductStock = Number(current.stock_quantity ?? 0) - item.quantity;
      const { error: productUpdateError } = await supabase
        .from("products")
        .update({ stock_quantity: nextProductStock, updated_at: new Date().toISOString() })
        .eq("id", item.product_id);

      if (productUpdateError) {
        await supabase.from("sale_items").delete().eq("sale_id", sale.id);
        await supabase.from("sales").delete().eq("id", sale.id);
        throw new Error(productUpdateError.message);
      }

      const { error: productTxnError } = await supabase.from("inventory_transactions").insert({
        product_id: item.product_id,
        transaction_type: "sale",
        quantity: -item.quantity,
        reference: receipt,
        created_by: userId,
      });

      if (productTxnError) {
        await supabase.from("sale_items").delete().eq("sale_id", sale.id);
        await supabase.from("sales").delete().eq("id", sale.id);
        throw new Error(productTxnError.message);
      }
    }

    return { sale, items: data.items, subtotal, tax, total };
  });

export const listSales = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const all: any[] = [];
    const pageSize = 1000;
    let from = 0;
    while (true) {
      const { data, error } = await context.supabase
        .from("sales")
        .select("*, sale_items(id, quantity, unit_price, products(name))")
        .order("sale_date", { ascending: false })
        .range(from, from + pageSize - 1);
      if (error) throw new Error(error.message);
      const batch = data ?? [];
      all.push(...batch);
      if (batch.length < pageSize) break;
      from += pageSize;
    }
    return all;
  });

// ============ INVENTORY ============
export const adjustIngredient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    item_id: z.string().uuid(),
    quantity: z.number().min(0),
    type: z.enum(["In", "Out", "Waste"]),
    reference: z.string().max(200).optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await requireInventoryWriteAccess(context.supabase, context.userId);
    const amount = data.type === "In" ? data.quantity : -data.quantity;
    const { data: item, error: readError } = await context.supabase.from("inventory_items")
      .select("current_stock").eq("id", data.item_id).single();
    if (readError) throw new Error(readError.message);
    const currentStock = Number(item.current_stock ?? 0);
    if (currentStock + amount < 0) throw new Error("Resulting stock cannot be negative");
    const { error: updateError } = await context.supabase.from("inventory_items")
      .update({ current_stock: currentStock + amount }).eq("id", data.item_id);
    if (updateError) throw new Error(updateError.message);
    const { error: movementError } = await context.supabase.from("inventory_movements").insert({
      item_id: data.item_id, type: data.type, qty: amount, reference: data.reference ?? "manual",
    });
    if (movementError) throw new Error(movementError.message);
    return { ok: true };
  });

export const listInventoryMovements = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const [ingredientMovements, productTransactions] = await Promise.all([
      context.supabase.from("inventory_movements")
        .select("*, inventory_items!left(name, unit)").order("created_at", { ascending: false }),
      context.supabase.from("inventory_transactions")
        .select("id, product_id, transaction_type, quantity, reference, created_at, products!left(name)")
        .order("created_at", { ascending: false }),
    ]);
    if (ingredientMovements.error) throw new Error(ingredientMovements.error.message);
    if (productTransactions.error) throw new Error(productTransactions.error.message);

    return [
      ...(ingredientMovements.data ?? []).map((movement) => ({
        ...movement,
        item_name: movement.inventory_items?.name ?? "Unknown ingredient",
        unit: movement.inventory_items?.unit ?? "",
      })),
      ...(productTransactions.data ?? []).map((transaction) => ({
        id: `product-${transaction.id}`,
        created_at: transaction.created_at,
        item_name: transaction.products?.name ?? "Unknown product",
        type: transaction.transaction_type === "sale" ? "Sale" : transaction.transaction_type,
        qty: transaction.quantity,
        reference: transaction.reference,
        unit: "pcs",
      })),
    ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  });

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

    await requireInventoryWriteAccess(supabase, userId);

    const { data: prod, error: pe } = await supabase.from("products").select("stock_quantity").eq("id", data.product_id).single();
    if (pe) throw new Error(pe.message);
    if (!prod) throw new Error("Product not found");

    let newStock = Number(prod.stock_quantity ?? 0);
    if (data.transaction_type === "in") {
      newStock += Math.abs(data.quantity);
    } else if (data.transaction_type === "out") {
      newStock -= Math.abs(data.quantity);
    } else {
      newStock = Math.max(0, data.quantity);
    }

    if (newStock < 0) throw new Error("Resulting stock cannot be negative");

    const { data: updatedProduct, error: ue } = await supabase
      .from("products")
      .update({ stock_quantity: newStock, updated_at: new Date().toISOString() })
      .eq("id", data.product_id)
      .select("id, stock_quantity")
      .single();

    if (ue) throw new Error(ue.message);
    if (!updatedProduct) throw new Error("Inventory update did not affect the product row");

    const { error: te } = await supabase.from("inventory_transactions").insert({
      product_id: data.product_id,
      transaction_type: data.transaction_type,
      quantity: data.transaction_type === "out" ? -Math.abs(data.quantity) : data.quantity,
      reference: data.reference ?? "manual",
      created_by: userId,
    });

    if (te) throw new Error(te.message);

    return { ok: true, product_id: data.product_id, newStock, transaction_type: data.transaction_type };
  });

export const listInventoryTxns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const all: any[] = [];
    const pageSize = 1000;
    let from = 0;
    while (true) {
      const { data, error } = await context.supabase
        .from("inventory_transactions")
        .select("*, products(name)")
        .order("created_at", { ascending: false })
        .range(from, from + pageSize - 1);
      if (error) throw new Error(error.message);
      const batch = data ?? [];
      all.push(...batch);
      if (batch.length < pageSize) break;
      from += pageSize;
    }
    return all;
  });
