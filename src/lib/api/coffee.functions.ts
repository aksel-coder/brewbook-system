import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getLowStockInventory, normalizeCategoryType, resolveCategoryInventoryType } from "@/lib/api/low-stock";

export { normalizeCategoryType, resolveCategoryInventoryType };

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
    const [salesInRange, salesToday, products, recent, completedSales, inventoryItems, recipesResult] = await Promise.all([
      salesInRangePromise,
      supabase.from("sales").select("id, total_amount").gte("sale_date", today.toISOString()),
      supabase.from("products").select("id, name, stock_quantity, low_stock_threshold, categories(id, name, category_type)").eq("is_active", true),
      supabase.from("sales").select("id, receipt_number, total_amount, sale_date").gte("sale_date", data.startDate).lte("sale_date", data.endDate).order("sale_date", { ascending: false }).limit(5),
      supabase.from("sales").select("id, sale_items(quantity, product_id)").order("sale_date", { ascending: false }),
      supabase.from("inventory_items").select("id, name, current_stock, low_stock_threshold").order("name"),
      supabase.from("product_recipes").select("product_id, item_id, quantity_required").order("product_id"),
    ]);

    for (const result of [salesInRange, salesToday, products, recent, completedSales, inventoryItems, recipesResult]) {
      if (result.error) throw new Error(result.error.message);
    }

    const totalSales = (salesInRange.data ?? []).reduce((s, r) => s + Number(r.total_amount), 0);
    const todaySales = (salesToday.data ?? []).reduce((s, r) => s + Number(r.total_amount), 0);
    const orderCount = salesInRange.data?.length ?? 0;
    const productsWithSales = enrichProductsWithSales(products.data ?? [], completedSales.data ?? []);
    const totalProducts = productsWithSales.length;
    const totalStock = productsWithSales.reduce((s, p) => s + Math.max(0, Number(p.stock_quantity ?? 0)), 0);
    const recipesByProduct = new Map<string, any[]>();
    for (const recipe of recipesResult.data ?? []) {
      const current = recipesByProduct.get(recipe.product_id) ?? [];
      current.push(recipe);
      recipesByProduct.set(recipe.product_id, current);
    }
    const lowStockItems = getLowStockInventory({
      products: productsWithSales,
      inventoryItems: inventoryItems.data ?? [],
      recipesByProduct,
    });

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
    const [productsResult, salesResult, recipesResult, transactionsResult] = await Promise.all([
      context.supabase.from("products").select("*, categories(id, name, category_type), product_variants(id, name, price, recipes)").order("name"),
      context.supabase.from("sales").select("id, sale_items(quantity, product_id)").order("sale_date", { ascending: false }),
      context.supabase.from("product_recipes").select("product_id, quantity_required, inventory_items(current_stock)"),
      context.supabase.from("inventory_transactions").select("product_id, transaction_type, quantity, reference"),
    ]);

    if (productsResult.error) throw new Error(productsResult.error.message);
    if (salesResult.error) throw new Error(salesResult.error.message);
    if (recipesResult.error) throw new Error(recipesResult.error.message);
    if (transactionsResult.error) throw new Error(transactionsResult.error.message);

    const addedStockByProduct = new Map<string, number>();
    for (const transaction of transactionsResult.data ?? []) {
      if (transaction.transaction_type !== "in" || transaction.reference === "Initial finished good product creation") continue;
      addedStockByProduct.set(
        transaction.product_id,
        (addedStockByProduct.get(transaction.product_id) ?? 0) + Number(transaction.quantity ?? 0),
      );
    }

    const recipesByProduct = new Map<string, any[]>();
    for (const recipe of recipesResult.data ?? []) {
      const current = recipesByProduct.get(recipe.product_id) ?? [];
      current.push(recipe);
      recipesByProduct.set(recipe.product_id, current);
    }

    return enrichProductsWithSales(productsResult.data ?? [], salesResult.data ?? []).map((product) => {
      const recipes = recipesByProduct.get(product.id) ?? [];
      const targetType = resolveCategoryInventoryType(product?.categories?.category_type, recipes);
      const availableStock = targetType === "recipe_based" && recipes.length > 0
        ? Math.min(...recipes.map((recipe) => Math.floor(Number(recipe.inventory_items?.current_stock ?? 0) / Number(recipe.quantity_required))))
        : Number(product.stock_quantity ?? 0);
      return {
        ...product,
        added_stock: Math.max(0, addedStockByProduct.get(product.id) ?? 0),
        inventory_type: targetType,
        available_stock: Math.max(0, availableStock),
      };
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
    const { data, error } = await context.supabase
      .from("inventory_items")
      .select("id, name, unit, initial_stock, added_stock, total_used, current_stock, low_stock_threshold, created_at")
      .order("name");
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
      : { ...data, current_stock: data.initial_stock, added_stock: 0 };
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

export const listProductVariants = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ product_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: variants, error } = await context.supabase
      .from("product_variants")
      .select("id, product_id, name, price, recipes")
      .eq("product_id", data.product_id)
      .order("created_at");
    if (error) throw new Error(error.message);
    return variants ?? [];
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
  variants: z.array(z.object({
    id: z.string().uuid().optional(),
    name: z.string().min(1).max(80),
    price: z.number().min(0),
    recipes: z.array(z.object({ item_id: z.string().uuid(), quantity_required: z.number().positive() })).default([]),
  })).default([]),
});

export const upsertProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => productSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requireAdminRole(supabase, userId, "product management");

    const { recipes, variants, stock_quantity, ...editableProductData } = data;
    let productId = data.id;

    const { data: category, error: categoryError } = data.category_id
      ? await supabase.from("categories").select("category_type").eq("id", data.category_id).single()
      : { data: null, error: null };
    if (categoryError) throw new Error(categoryError.message);
    if (variants.length > 0 && category?.category_type !== "recipe_based") {
      throw new Error("Size variants are available only for recipe-based products");
    }

    if (data.id) {
      const { error } = await supabase.from("products").update({ ...editableProductData, updated_at: new Date().toISOString() }).eq("id", data.id);
      if (error) throw new Error(error.message);
    } else {
      const initialStock = category?.category_type === "recipe_based" ? 0 : stock_quantity;
      const { data: product, error } = await (supabase.from("products") as any)
        .insert({ ...editableProductData, stock_quantity: initialStock })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      const createdProductId = product.id as string;
      productId = createdProductId;

      if (category?.category_type !== "recipe_based" && initialStock > 0) {
        const { error: movementError } = await supabase.from("inventory_transactions").insert({
          product_id: createdProductId,
          transaction_type: "in",
          quantity: initialStock,
          reference: "Initial finished good product creation",
          created_by: userId,
        });
        if (movementError) throw new Error(movementError.message);
      }
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

    if (category?.category_type === "recipe_based") {
      const { data: existingVariants, error: existingVariantsError } = await supabase
        .from("product_variants").select("id").eq("product_id", productId);
      if (existingVariantsError) throw new Error(existingVariantsError.message);
      const submittedVariantIds = variants.flatMap((variant) => variant.id ? [variant.id] : []);
      const variantsToDelete = (existingVariants ?? [])
        .map((variant: any) => variant.id)
        .filter((id: string) => !submittedVariantIds.includes(id));
      if (variantsToDelete.length > 0) {
        const { error } = await supabase.from("product_variants").delete().in("id", variantsToDelete);
        if (error) throw new Error(error.message);
      }
      for (const variant of variants) {
        const variantResult = variant.id
          ? await supabase.from("product_variants").update({ name: variant.name, price: variant.price, recipes: variant.recipes }).eq("id", variant.id).eq("product_id", productId).select("id").single()
          : await supabase.from("product_variants").insert({ product_id: productId, name: variant.name, price: variant.price, recipes: variant.recipes }).select("id").single();
        if (variantResult.error) throw new Error(variantResult.error.message);
      }
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
  .inputValidator((d) => z.object({
    id: z.string().uuid().optional(),
    name: z.string().min(1).max(80),
    category_type: z.enum(["Finished Good", "recipe_based"]),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdminRole(context.supabase, context.userId, "category management");

    if (data.id) {
      const { error } = await context.supabase.from("categories").update({ name: data.name, category_type: data.category_type }).eq("id", data.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await context.supabase.from("categories").insert({ name: data.name, category_type: data.category_type });
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
    variant_id: z.string().uuid().optional(),
    quantity: z.number().int().min(1),
  })).min(1).max(100),
  tax_rate: z.number().min(0).max(1).default(0),
});

export const createSale = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => saleSchema.parse(d))
  .handler(async ({ data, context }) => {
    const receipt = "CZ-" + Date.now().toString(36).toUpperCase();
    const { data: checkout, error } = await context.supabase.rpc("process_sale_checkout", {
      p_user_id: context.userId,
      p_receipt_number: receipt,
      p_reservation_id: null,
      p_items: data.items.map(({ product_id, variant_id, quantity }) => ({
        product_id,
        variant_id: variant_id ?? null,
        quantity,
      })),
    });

    if (error) {
      console.error("Unable to complete POS checkout:", {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
      });
      if (error.code === "P0001" && error.message === "Sale operator is not authorized") {
        const { data: operatorRoles, error: roleLookupError } = await context.supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", context.userId);
        console.error("POS operator authorization diagnostic:", {
          operatorMatchesAuthenticatedUser: true,
          hasAdminRole: operatorRoles?.some((row) => row.role === "admin") ?? false,
          hasCashierRole: operatorRoles?.some((row) => row.role === "cashier") ?? false,
          roleLookupError: roleLookupError?.message,
        });
      }
      if (error.code === "PGRST202") {
        throw new Error(
          "Supabase does not currently expose the POS checkout function. Verify that it exists, then refresh the Supabase API schema cache.",
        );
      }
      if (error.message.includes("Insufficient product stock") || error.message.includes("Insufficient ingredient stock")) {
        throw new Error("Insufficient stock. Refresh the product list and try again.");
      }
      if (!import.meta.env.PROD) {
        throw new Error(
          `${error.code}: ${error.message}${error.details ? ` (${error.details})` : ""}`,
        );
      }
      throw new Error("The sale could not be completed. Please retry the checkout.");
    }

    const result = z.object({
      sale: z.object({
        id: z.string().uuid(),
        receipt_number: z.string(),
        user_id: z.string().uuid(),
        subtotal: z.number(),
        tax: z.number(),
        total_amount: z.number(),
        sale_date: z.string(),
        reservation_id: z.string().uuid().nullable(),
      }),
      subtotal: z.number(),
      tax: z.number(),
      total: z.number(),
      items: z.array(
        z.object({
          product_id: z.string().uuid(),
          variant_id: z.string().uuid().nullable(),
          product_name: z.string(),
          variant_name: z.string().nullable(),
          quantity: z.number().int(),
          unit_price: z.number(),
          subtotal: z.number(),
        }),
      ),
    }).safeParse(checkout);

    if (!result.success) {
      console.error("POS checkout returned an invalid response:", result.error);
      throw new Error("The sale response could not be verified. Contact an administrator before retrying.");
    }

    return {
      ...result.data,
      items: result.data.items.map((item) => ({
        product_id: item.product_id,
        variant_id: item.variant_id ?? undefined,
        name: item.product_name,
        variant_name: item.variant_name ?? undefined,
        quantity: item.quantity,
        price: item.unit_price,
        stock: item.quantity,
      })),
    };
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
        .select(
          "*, reservation:reservations(reservation_number), sale_items(id, quantity, unit_price, variant_name, products(name))",
        )
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
      .select("initial_stock, added_stock, total_used, current_stock").eq("id", data.item_id).single();
    if (readError) throw new Error(readError.message);

    const currentInitial = Number(item?.initial_stock ?? 0);
    const currentAdded = Number(item?.added_stock ?? 0);
    const currentUsed = Number(item?.total_used ?? 0);
    const currentStock = Number(item?.current_stock ?? 0);

    let nextInitial = currentInitial;
    let nextAdded = currentAdded;
    let nextUsed = currentUsed;
    let nextCurrent = currentStock;

    if (data.type === "In") {
      nextInitial = currentInitial + data.quantity;
      nextAdded = currentAdded + data.quantity;
      nextCurrent = currentStock + data.quantity;
      nextUsed = currentUsed;
    } else {
      nextInitial = currentInitial;
      nextAdded = currentAdded;
      nextUsed = currentUsed + data.quantity;
      nextCurrent = currentStock - data.quantity;
      if (nextCurrent < 0) throw new Error("Resulting stock cannot be negative");
    }

    const { error: updateError } = await context.supabase.from("inventory_items")
      .update({
        initial_stock: nextInitial,
        added_stock: nextAdded,
        total_used: nextUsed,
        current_stock: nextCurrent,
      }).eq("id", data.item_id);
    if (updateError) throw new Error(updateError.message);

    const { error: movementError } = await context.supabase.from("inventory_movements").insert({
      item_id: data.item_id, type: data.type, qty: amount, reference: data.reference ?? "manual",
    });
    if (movementError) throw new Error(movementError.message);
    return { ok: true };
  });

const normalizeMovementType = (type?: string | null) => {
  if (!type) return "Stock In";
  const normalized = String(type).trim();
  if (normalized === "In") return "Stock In";
  if (normalized === "Out") return "Stock Out";
  if (normalized === "Waste") return "Stock Out";
  if (normalized === "sale") return "Sale/Used";
  if (normalized === "Sale") return "Sale/Used";
  if (normalized === "in") return "Stock In";
  if (normalized === "out") return "Stock Out";
  if (normalized === "adjust") return "Stock Out";
  return normalized;
};

export const listInventoryMovements = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const [ingredientMovements, productTransactions] = await Promise.all([
      context.supabase.from("inventory_movements").select("*").order("created_at", { ascending: false }),
      context.supabase.from("inventory_transactions").select("*").order("created_at", { ascending: false }),
    ]);
    if (ingredientMovements.error) throw new Error(ingredientMovements.error.message);
    if (productTransactions.error) throw new Error(productTransactions.error.message);

    const ingredientRows = await Promise.all((ingredientMovements.data ?? []).map(async (movement) => {
      const { data: item, error } = await context.supabase
        .from("inventory_items")
        .select("name, unit")
        .eq("id", movement.item_id)
        .single();

      if (error && error.code !== "PGRST116") throw new Error(error.message);

      return {
        id: `ingredient-${movement.id}`,
        created_at: movement.created_at,
        item_name: item?.name ?? "Unknown ingredient",
        type: normalizeMovementType(movement.type),
        qty: Number(movement.qty ?? 0),
        reference: movement.reference ?? "",
        unit: item?.unit ?? "",
      };
    }));

    const productRows = await Promise.all((productTransactions.data ?? []).map(async (transaction) => {
      const { data: product, error } = await context.supabase
        .from("products")
        .select("name")
        .eq("id", transaction.product_id)
        .single();

      if (error && error.code !== "PGRST116") throw new Error(error.message);

      return {
        id: `product-${transaction.id}`,
        created_at: transaction.created_at,
        item_name: product?.name ?? "Unknown product",
        type: normalizeMovementType(transaction.transaction_type),
        qty: Number(transaction.quantity ?? 0),
        reference: transaction.reference ?? "",
        unit: "pcs",
      };
    }));

    return [...ingredientRows, ...productRows]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
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

    const { data: prod, error: pe } = await (supabase.from("products") as any)
      .select("stock_quantity, total_used")
      .eq("id", data.product_id)
      .single();
    if (pe) throw new Error(pe.message);
    if (!prod) throw new Error("Product not found");

    const quantity = Math.abs(data.quantity);
    const currentStock = Number(prod.stock_quantity ?? 0);
    const currentUsed = Number(prod.total_used ?? 0);
    let newStock = currentStock;
    let newUsed = currentUsed;
    if (data.transaction_type === "in") {
      newStock += quantity;
    } else if (data.transaction_type === "out") {
      newUsed += quantity;
      newStock -= quantity;
    } else {
      newStock = Math.max(0, quantity);
    }

    if (newStock < 0) throw new Error("Resulting stock cannot be negative");

    const { data: updatedProduct, error: ue } = await (supabase.from("products") as any)
      .update({
        total_used: newUsed,
        stock_quantity: newStock,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.product_id)
      .select("id, stock_quantity, total_used")
      .single();

    if (ue) throw new Error(ue.message);
    if (!updatedProduct) throw new Error("Inventory update did not affect the product row");

    const { error: te } = await supabase.from("inventory_transactions").insert({
      product_id: data.product_id,
      transaction_type: data.transaction_type,
      quantity: data.transaction_type === "out" ? -quantity : quantity,
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
