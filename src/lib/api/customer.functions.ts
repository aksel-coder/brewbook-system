import { createServerFn } from "@tanstack/react-start";
import { hasSupabaseServiceRole, supabaseAdmin } from "@/integrations/supabase/client.server";

export type CustomerCatalogProduct = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  image_url: string | null;
  category: string | null;
  inventory_type: "Finished Good" | "recipe_based";
  available_stock: number;
  variants: { id: string; name: string; price: number; available_stock: number }[];
};

type RecipeRequirement = {
  item_id: string;
  quantity_required: number;
};

function parseVariantRecipes(value: unknown): RecipeRequirement[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return [];
    const recipe = entry as Record<string, unknown>;
    const itemId =
      typeof recipe.item_id === "string"
        ? recipe.item_id
        : typeof recipe.ingredient_id === "string"
          ? recipe.ingredient_id
          : "";
    const quantity = Number(recipe.quantity_required ?? recipe.quantity);
    if (!itemId || !Number.isFinite(quantity) || quantity <= 0) return [];
    return [{ item_id: itemId, quantity_required: quantity }];
  });
}

function getRecipeAvailability(
  recipes: RecipeRequirement[],
  stockByIngredient: Map<string, number>,
): number {
  if (recipes.length === 0) return 0;

  const requiredByIngredient = new Map<string, number>();
  for (const recipe of recipes) {
    requiredByIngredient.set(
      recipe.item_id,
      (requiredByIngredient.get(recipe.item_id) ?? 0) + recipe.quantity_required,
    );
  }

  const servings = [...requiredByIngredient].map(([itemId, quantityRequired]) => {
    const stock = stockByIngredient.get(itemId);
    if (stock === undefined) return 0;
    return Math.floor(Math.max(0, stock) / quantityRequired);
  });
  return servings.length > 0 ? Math.min(...servings) : 0;
}

export const listCustomerCatalog = createServerFn({ method: "GET" }).handler(async () => {
  if (!hasSupabaseServiceRole()) {
    throw new Error("Customer catalog requires SUPABASE_SERVICE_ROLE_KEY on the server.");
  }

  const { data: products, error: productsError } = await supabaseAdmin
    .from("products")
    .select("id, name, description, price, image_url, category_id, stock_quantity")
    .eq("is_active", true)
    .order("name");
  if (productsError) throw new Error(productsError.message);
  if (!products?.length) return [];

  const productIds = products.map((product) => product.id);
  const categoryIds = [
    ...new Set(products.flatMap((product) => (product.category_id ? [product.category_id] : []))),
  ];
  const [categoriesResult, variantsResult] = await Promise.all([
    categoryIds.length
      ? supabaseAdmin.from("categories").select("id, name, category_type").in("id", categoryIds)
      : Promise.resolve({ data: [], error: null }),
    supabaseAdmin
      .from("product_variants")
      .select("id, product_id, name, price, recipes")
      .in("product_id", productIds),
  ]);

  if (categoriesResult.error) throw new Error(categoriesResult.error.message);
  if (variantsResult.error) throw new Error(variantsResult.error.message);

  const categoriesById = new Map(
    (categoriesResult.data ?? []).map((category) => [
      category.id,
      { name: category.name, type: category.category_type },
    ]),
  );
  const [productRecipesResult, inventoryResult] = await Promise.all([
    supabaseAdmin
      .from("product_recipes")
      .select("product_id, item_id, quantity_required")
      .in("product_id", productIds),
    supabaseAdmin.from("inventory_items").select("id, current_stock"),
  ]);
  if (productRecipesResult.error) throw new Error(productRecipesResult.error.message);
  if (inventoryResult.error) throw new Error(inventoryResult.error.message);

  const stockByIngredient = new Map(
    (inventoryResult.data ?? []).map((item) => [item.id, Number(item.current_stock)]),
  );
  const recipesByProduct = new Map<string, RecipeRequirement[]>();
  for (const recipe of productRecipesResult.data ?? []) {
    const recipes = recipesByProduct.get(recipe.product_id) ?? [];
    recipes.push({
      item_id: recipe.item_id,
      quantity_required: Number(recipe.quantity_required),
    });
    recipesByProduct.set(recipe.product_id, recipes);
  }
  const variantsByProduct = new Map<string, CustomerCatalogProduct["variants"]>();
  for (const variant of variantsResult.data ?? []) {
    const variants = variantsByProduct.get(variant.product_id) ?? [];
    const variantRecipes = parseVariantRecipes(variant.recipes);
    variants.push({
      id: variant.id,
      name: variant.name,
      price: Number(variant.price),
      available_stock: getRecipeAvailability(variantRecipes, stockByIngredient),
    });
    variantsByProduct.set(variant.product_id, variants);
  }

  return Promise.all(
    products.map(async (product) => {
      let imageUrl = product.image_url;
      if (imageUrl && !/^https?:\/\//i.test(imageUrl)) {
        const { data, error } = await supabaseAdmin.storage
          .from("product-images")
          .createSignedUrl(imageUrl, 3600);
        if (error) throw new Error(error.message);
        imageUrl = data.signedUrl;
      }

      return {
        id: product.id,
        name: product.name,
        description: product.description,
        price: Number(product.price),
        image_url: imageUrl,
        category: product.category_id
          ? (categoriesById.get(product.category_id)?.name ?? null)
          : null,
        inventory_type:
          categoriesById.get(product.category_id ?? "")?.type === "recipe_based"
            ? ("recipe_based" as const)
            : ("Finished Good" as const),
        available_stock:
          categoriesById.get(product.category_id ?? "")?.type === "recipe_based"
            ? getRecipeAvailability(recipesByProduct.get(product.id) ?? [], stockByIngredient)
            : Math.max(0, Number(product.stock_quantity ?? 0)),
        variants: variantsByProduct.get(product.id) ?? [],
      };
    }),
  );
});
