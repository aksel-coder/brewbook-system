export const normalizeCategoryType = (categoryType?: string | null) => {
  if (categoryType == null) return "Finished Good";

  const cleaned = String(categoryType)
    .replace(/'/g, "")
    .replace(/::text/gi, "")
    .trim();

  if (cleaned === "Finished Good" || cleaned === "recipe_based") return cleaned;
  return "Finished Good";
};

export const resolveCategoryInventoryType = (categoryType?: string | null, recipes: any[] = []) => {
  const normalized = normalizeCategoryType(categoryType);
  if (normalized === "recipe_based" || normalized === "Finished Good") return normalized;
  return recipes.length > 0 ? "recipe_based" : "Finished Good";
};

export const getLowStockInventory = ({
  products = [],
  inventoryItems = [],
  recipesByProduct = new Map(),
}: {
  products?: any[];
  inventoryItems?: any[];
  recipesByProduct?: Map<string, any[]>;
}) => {
  const output: any[] = [];

  for (const item of inventoryItems) {
    const remainingStock = Math.max(0, Number(item?.current_stock ?? 0));
    const threshold = Number(item?.low_stock_threshold ?? 0);
    if (remainingStock <= threshold) {
      output.push({
        id: item.id,
        name: item.name,
        stock_quantity: remainingStock,
        low_stock_threshold: threshold,
        kind: "ingredient",
        category: "Raw Ingredient",
        inventory_type: "ingredient",
      });
    }
  }

  for (const product of products) {
    const recipes = recipesByProduct.get(product?.id) ?? [];
    const inventoryType = resolveCategoryInventoryType(
      normalizeCategoryType(product?.categories?.category_type),
      recipes,
    );

    if (inventoryType === "recipe_based") continue;

    const remainingStock = Math.max(0, Number(product?.stock_quantity ?? 0));
    const threshold = Number(product?.low_stock_threshold ?? 0);
    if (remainingStock <= threshold) {
      output.push({
        id: product.id,
        name: product.name,
        stock_quantity: remainingStock,
        low_stock_threshold: threshold,
        kind: "product",
        category: product?.categories?.name ?? "Finished Good",
        inventory_type: "Finished Good",
      });
    }
  }

  return output.sort((a, b) => a.name.localeCompare(b.name));
};
