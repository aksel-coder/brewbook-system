import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listProducts, listCategories, listInventoryItems, listProductRecipes, listProductVariants, upsertProduct, deleteProduct, upsertCategory, deleteCategory, upsertInventoryItem, deleteInventoryItem } from "@/lib/api/coffee.functions";
import { getMyRole } from "@/lib/api/users.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { ImageIcon, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { DataTablePagination } from "@/components/data-table-pagination";
import { usePagination } from "@/hooks/use-pagination";

function ProductImage({ path, className }: { path?: string | null; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!path) { setUrl(null); return; }
    if (/^https?:\/\//.test(path)) { setUrl(path); return; }
    supabase.storage.from("product-images").createSignedUrl(path, 3600).then(({ data }) => {
      if (!cancelled) setUrl(data?.signedUrl ?? null);
    });
    return () => { cancelled = true; };
  }, [path]);
  if (!url) return <div className={`flex items-center justify-center bg-muted text-muted-foreground ${className ?? ""}`}><ImageIcon className="h-4 w-4" /></div>;
  return <img src={url} alt="" className={`object-cover ${className ?? ""}`} />;
}

export const Route = createFileRoute("/_authenticated/products")({
  head: () => ({ meta: [{ title: "Products — Coffee Zone" }] }),
  component: Products,
});

const peso = (n: number) => "₱" + Number(n).toLocaleString("en-PH", { minimumFractionDigits: 2 });
const formatPriceRange = (variants: any[]) => {
  const prices = variants.map((variant) => Number(variant?.price)).filter((price) => Number.isFinite(price) && price >= 0);
  if (prices.length === 0) return "—";
  const minimum = Math.min(...prices);
  const maximum = Math.max(...prices);
  return minimum === maximum ? peso(minimum) : `${peso(minimum)} – ${peso(maximum)}`;
};
const blank = { id: "", name: "", description: "", category_id: "", price: "", stock_quantity: "", low_stock_threshold: "10", image_url: "" };
type RecipeDraft = { item_id: string; quantity_required: string };
type VariantDraft = { id?: string; name: string; price: string; recipes: RecipeDraft[] };

function ProductTable({
  title,
  products,
  emptyMessage,
  isAdmin,
  onEdit,
  onDelete,
  variantTable = false,
  recipeIngredients = [],
}: {
  title: string;
  products: any[];
  emptyMessage: string;
  isAdmin: boolean;
  onEdit: (product: any) => void;
  onDelete: (id: string) => void;
  variantTable?: boolean;
  recipeIngredients?: any[];
}) {
  const hasVariants = variantTable;

  return <Card>
    <CardHeader><CardTitle className="font-display">{title}</CardTitle></CardHeader>
    <CardContent className="overflow-x-auto p-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Image</TableHead>
            <TableHead>{hasVariants ? "Drink Name" : "Product Name"}</TableHead>
            <TableHead>Category</TableHead>
            <TableHead className="text-right">{hasVariants ? "Price Range" : "Price"}</TableHead>
            {hasVariants && <TableHead>Variants &amp; Recipes</TableHead>}
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {products.length === 0 ? <TableRow><TableCell colSpan={hasVariants ? 6 : 5} className="h-24 align-middle text-center text-muted-foreground">{emptyMessage}</TableCell></TableRow> : products.map((product) => {
            const variants = Array.isArray(product.product_variants) ? product.product_variants : [];
            return <TableRow key={product.id}>
              <TableCell className="align-middle"><ProductImage path={product.image_url} className="h-14 w-14 rounded-lg border" /></TableCell>
              <TableCell className="align-middle font-medium">{product.name}</TableCell>
              <TableCell className="align-middle">{product.categories?.name ?? "—"}</TableCell>
              <TableCell className="align-middle text-right font-medium">{hasVariants ? formatPriceRange(variants) : peso(product.price)}</TableCell>
              {hasVariants && <TableCell className="min-w-70 align-middle">
                <div className="space-y-2">
                  {variants.map((variant: any) => <div key={variant.id} className="rounded-md border bg-muted/20 px-2.5 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary" className="font-medium">{variant.name}</Badge>
                      <span className="text-sm font-semibold text-primary">{peso(Number(variant.price))}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                      {(Array.isArray(variant.recipes) ? variant.recipes : []).length > 0 ? variant.recipes.map((recipe: any, index: number) => {
                        const ingredient = recipeIngredients.find((item) => item.id === (recipe.item_id ?? recipe.ingredient_id));
                        const quantity = recipe.quantity_required ?? recipe.quantity;
                        return <span key={`${variant.id}-${recipe.item_id ?? recipe.ingredient_id ?? index}`} className="text-xs text-muted-foreground">{ingredient?.name ?? "Unknown ingredient"} ({quantity} {ingredient?.unit ?? ""}){index < variant.recipes.length - 1 ? " ·" : ""}</span>;
                      }) : <span className="text-xs text-muted-foreground">No ingredients</span>}
                    </div>
                  </div>)}
                </div>
              </TableCell>}
              <TableCell className="align-middle text-right">
                {isAdmin && <div className="flex items-center justify-end gap-1">
                  <Button size="icon" variant="ghost" onClick={() => onEdit(product)}><Pencil className="h-4 w-4" /></Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild><Button size="icon" variant="ghost" className="text-destructive"><Trash2 className="h-4 w-4" /></Button></AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader><AlertDialogTitle>Delete {product.name}?</AlertDialogTitle><AlertDialogDescription>This cannot be undone.</AlertDialogDescription></AlertDialogHeader>
                      <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => onDelete(product.id)}>Delete</AlertDialogAction></AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>}
              </TableCell>
            </TableRow>;
          })}
        </TableBody>
      </Table>
    </CardContent>
  </Card>;
}

function Products() {
  const fn = useServerFn(listProducts);
  const catFn = useServerFn(listCategories);
  const ingredientFn = useServerFn(listInventoryItems);
  const recipeFn = useServerFn(listProductRecipes);
  const variantFn = useServerFn(listProductVariants);
  const save = useServerFn(upsertProduct);
  const del = useServerFn(deleteProduct);
  const saveCat = useServerFn(upsertCategory);
  const delCat = useServerFn(deleteCategory);
  const saveIngredient = useServerFn(upsertInventoryItem);
  const delIngredient = useServerFn(deleteInventoryItem);
  const fetchRole = useServerFn(getMyRole);
  const qc = useQueryClient();

  const { data: products = [] } = useQuery({ queryKey: ["products"], queryFn: () => fn() });
  const { data: categories = [] } = useQuery({ queryKey: ["categories"], queryFn: () => catFn() });
  const { data: ingredients = [] } = useQuery({ queryKey: ["inventoryItems"], queryFn: () => ingredientFn() });
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: () => fetchRole() });
  const isAdmin = !!me?.isAdmin;

  const safeProducts = Array.isArray(products) ? products.filter(Boolean) : [];
  const safeCategories = Array.isArray(categories) ? categories.filter(Boolean) : [];
  const safeIngredients = Array.isArray(ingredients) ? ingredients.filter(Boolean) : [];

  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [form, setForm] = useState(blank);
  const [catOpen, setCatOpen] = useState(false);
  const [catName, setCatName] = useState("");
  const [catType, setCatType] = useState<"Finished Good" | "recipe_based">("Finished Good");
  const [ingredientForm, setIngredientForm] = useState({ name: "", unit: "g", initial_stock: "", low_stock_threshold: "" });
  const [recipes, setRecipes] = useState<RecipeDraft[]>([]);
  const [variants, setVariants] = useState<VariantDraft[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const filteredProducts = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const list = safeProducts;
    if (!query) return list as any[];
    return (list as any[]).filter((product) => {
      const name = typeof product?.name === "string" ? product.name : "";
      const categoryName = typeof product?.categories?.name === "string" ? product.categories.name : "";
      return name.toLowerCase().includes(query) || categoryName.toLowerCase().includes(query);
    });
  }, [safeProducts, searchQuery]);
  const finishedProducts = useMemo(() => filteredProducts.filter((product: any) => {
    const variants = Array.isArray(product.product_variants) ? product.product_variants : [];
    return product.categories?.category_type !== "recipe_based" && variants.length === 0;
  }), [filteredProducts]);
  const recipeProducts = useMemo(() => filteredProducts.filter((product: any) => {
    const variants = Array.isArray(product.product_variants) ? product.product_variants : [];
    return product.categories?.category_type === "recipe_based" || variants.length > 0;
  }), [filteredProducts]);
  const finishedPagination = usePagination(finishedProducts);
  const recipePagination = usePagination(recipeProducts);
  const handleUpload = async (file: File) => {
    if (!file.type.startsWith("image/")) { toast.error("Please choose an image file"); return; }
    if (file.size > 5 * 1024 * 1024) { toast.error("Max image size is 5MB"); return; }
    setUploading(true);
    try {
      const ext = file.name.split(".").pop() || "jpg";
      const path = `${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from("product-images").upload(path, file, { cacheControl: "3600", upsert: false });
      if (error) throw error;
      setForm((f) => ({ ...f, image_url: path }));
      toast.success("Image uploaded");
    } catch (e: any) { toast.error(e.message); }
    finally { setUploading(false); }
  };

  const edit = async (p: any) => {
    setForm({
      id: p.id, name: p.name, description: p.description ?? "",
      category_id: p.category_id ?? "", price: String(p.price),
      stock_quantity: String(p.stock_quantity), low_stock_threshold: String(p.low_stock_threshold),
      image_url: p.image_url ?? "",
    });
    const existing = await recipeFn({ data: { product_id: p.id } });
    setRecipes((Array.isArray(existing) ? existing : []).map((recipe) => ({
      item_id: recipe?.item_id ?? "",
      quantity_required: String(recipe?.quantity_required ?? ""),
    })));
    const existingVariants = await variantFn({ data: { product_id: p.id } });
    setVariants((Array.isArray(existingVariants) ? existingVariants : []).map((variant: any) => ({
      id: variant.id,
      name: variant.name,
      price: String(variant.price),
      recipes: (variant.recipes ?? []).map((recipe: any) => ({
        item_id: recipe.item_id ?? "",
        quantity_required: String(recipe.quantity_required ?? ""),
      })),
    })));
    setOpen(true);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload = {
        ...(form.id ? { id: form.id } : {}),
        name: form.name, description: form.description,
        category_id: form.category_id || null,
        price: isRecipeCategory ? 0 : Number(form.price),
        stock_quantity: form.stock_quantity === "" ? 0 : Number(form.stock_quantity),
        low_stock_threshold: Number(form.low_stock_threshold),
        image_url: form.image_url || null,
        recipes: recipes.filter((recipe) => recipe.item_id && Number(recipe.quantity_required) > 0).map((recipe) => ({
          item_id: recipe.item_id,
          quantity_required: Number(recipe.quantity_required),
        })),
        variants: isRecipeCategory ? variants.map((variant) => ({
          ...(variant.id ? { id: variant.id } : {}),
          name: variant.name,
          price: Number(variant.price),
          recipes: variant.recipes.filter((recipe) => recipe.item_id && Number(recipe.quantity_required) > 0).map((recipe) => ({
            item_id: recipe.item_id,
            quantity_required: Number(recipe.quantity_required),
          })),
        })) : [],
      };

      await save({ data: payload });
      toast.success("Product saved");
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["productRecipes"] });
      qc.invalidateQueries({ queryKey: ["inventoryItems"] });
      qc.invalidateQueries({ queryKey: ["inventoryMovements"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      setOpen(false); setForm(blank);
      setRecipes([]); setVariants([]);
    } catch (e: any) { toast.error(e.message); }
  };

  const addIngredient = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await saveIngredient({ data: {
        name: ingredientForm.name,
        unit: ingredientForm.unit as "g" | "ml" | "pcs" | "oz",
        initial_stock: Number(ingredientForm.initial_stock),
        low_stock_threshold: Number(ingredientForm.low_stock_threshold),
      } });
      toast.success("Ingredient added");
      setIngredientForm({ name: "", unit: "g", initial_stock: "", low_stock_threshold: "" });
      qc.invalidateQueries({ queryKey: ["inventoryItems"] });
    } catch (e: any) { toast.error(e.message); }
  };

  const remove = async (id: string) => {
    try {
      await del({ data: { id } });
      toast.success("Deleted");
      qc.invalidateQueries({ queryKey: ["products"] });
    }
    catch (e: any) { toast.error(e.message); }
  };

  const addCat = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await saveCat({ data: { name: catName.trim(), category_type: catType } });
      toast.success("Category added");
      setCatName("");
      setCatType("Finished Good");
      qc.invalidateQueries({ queryKey: ["categories"] });
    }
    catch (e: any) { toast.error(e.message); }
  };

  const selectedCategoryType = safeCategories.find((category) => category.id === form.category_id)?.category_type ?? "Finished Good";
  const isRecipeCategory = selectedCategoryType === "recipe_based";

  return (
    <div className="space-y-4">
      <h1 className="font-display text-3xl font-bold">Products</h1>
      <Tabs defaultValue="products">
        <TabsList>
          <TabsTrigger value="products">Products</TabsTrigger>
          <TabsTrigger value="categories">Categories</TabsTrigger>
          <TabsTrigger value="ingredients">Ingredients</TabsTrigger>
        </TabsList>
        <TabsContent value="products" className="space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Input
              className="sm:max-w-sm"
              placeholder="Search products..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {isAdmin && (
                <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setForm(blank); setRecipes([]); setVariants([]); } }}>
                <DialogTrigger asChild><Button><Plus className="mr-1 h-4 w-4" /> New Product</Button></DialogTrigger>
                <DialogContent className="overflow-y-auto">
                  <DialogHeader><DialogTitle>{form.id ? "Edit" : "New"} Product</DialogTitle></DialogHeader>
                  <form onSubmit={submit} className="space-y-3">
                    <div className="space-y-1.5"><Label>Name</Label><Input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
                    <div className="space-y-1.5"><Label>Description</Label><Textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
                    <div className="space-y-1.5">
                      <Label>Category</Label>
                      <Select value={form.category_id} onValueChange={v => setForm({ ...form, category_id: v })}>
                        <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                        <SelectContent>{(Array.isArray(categories) ? categories : []).map(c => <SelectItem key={c.id} value={c.id}>{c.name} ({c.category_type ?? "Finished Good"})</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    {!isRecipeCategory && <>
                      <div className="space-y-1.5"><Label>Price</Label><Input type="number" step="0.01" min="0" required value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} /></div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5"><Label>Stock Qty</Label><Input type="number" min="0" step="1" required={!form.id} disabled={!!form.id} value={form.stock_quantity} onChange={e => setForm({ ...form, stock_quantity: e.target.value })} /></div>
                        <div className="space-y-1.5"><Label>Low Stock Alert</Label><Input type="number" min="0" step="1" required value={form.low_stock_threshold} onChange={e => setForm({ ...form, low_stock_threshold: e.target.value })} /></div>
                      </div>
                    </>}
                    <div className="space-y-1.5">
                      <Label>Product Image</Label>
                      <div className="flex items-center gap-3">
                        <ProductImage path={form.image_url} className="h-16 w-16 rounded-md border" />
                        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.target.value = ""; }} />
                        <Button type="button" variant="outline" disabled={uploading} onClick={() => fileRef.current?.click()}>
                          <Upload className="mr-1 h-4 w-4" /> {uploading ? "Uploading…" : form.image_url ? "Replace" : "Upload"}
                        </Button>
                        {form.image_url && <Button type="button" variant="ghost" size="sm" onClick={() => setForm({ ...form, image_url: "" })}>Remove</Button>}
                      </div>
                    </div>
                    {!isRecipeCategory && <div className="space-y-2 border-t pt-3">
                      <Label>Recipe / Ingredients</Label>
                      {recipes.map((recipe, index) => {
                        const ingredient = (ingredients as any[]).find((item) => item.id === recipe.item_id);
                        return <div key={`${recipe.item_id}-${index}`} className="flex items-center gap-2">
                          <Select value={recipe.item_id} onValueChange={(value) => setRecipes((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, item_id: value } : row))}>
                            <SelectTrigger className="flex-1"><SelectValue placeholder="Select ingredient" /></SelectTrigger>
                            <SelectContent>{(Array.isArray(ingredients) ? ingredients : []).map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent>
                          </Select>
                          <Input className="w-24" type="number" min="0.001" step="any" required value={recipe.quantity_required} onChange={(e) => setRecipes((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, quantity_required: e.target.value } : row))} />
                          <span className="w-8 text-xs text-muted-foreground">{ingredient?.unit ?? "-"}</span>
                          <Button type="button" size="icon" variant="ghost" onClick={() => setRecipes((current) => current.filter((_, rowIndex) => rowIndex !== index))}><Trash2 className="h-4 w-4" /></Button>
                        </div>;
                      })}
                      <Button type="button" variant="outline" onClick={() => setRecipes((current) => [...current, { item_id: "", quantity_required: "" }])}><Plus className="mr-1 h-4 w-4" /> Add ingredient</Button>
                    </div>}
                    {isRecipeCategory && <div className="space-y-3 border-t pt-3">
                      <div className="flex items-center justify-between"><Label>Ingredients by Size</Label><Button type="button" variant="outline" size="sm" onClick={() => setVariants((current) => [...current, { name: "", price: "", recipes: [] }])}><Plus className="mr-1 h-4 w-4" /> Add size</Button></div>
                      {variants.map((variant, variantIndex) => <div key={variant.id ?? variantIndex} className="space-y-2 rounded-md border p-3">
                        <div className="grid grid-cols-2 gap-2">
                          <Input placeholder="Size name" required value={variant.name} onChange={(e) => setVariants((current) => current.map((row, index) => index === variantIndex ? { ...row, name: e.target.value } : row))} />
                          <Input placeholder="Price" type="number" min="0" step="0.01" required value={variant.price} onChange={(e) => setVariants((current) => current.map((row, index) => index === variantIndex ? { ...row, price: e.target.value } : row))} />
                        </div>
                        {variant.recipes.map((recipe, recipeIndex) => {
                          const ingredient = (ingredients as any[]).find((item) => item.id === recipe.item_id);
                          return <div key={`${recipe.item_id}-${recipeIndex}`} className="flex items-center gap-2">
                            <Select value={recipe.item_id} onValueChange={(value) => setVariants((current) => current.map((row, index) => index === variantIndex ? { ...row, recipes: row.recipes.map((item, itemIndex) => itemIndex === recipeIndex ? { ...item, item_id: value } : item) } : row))}>
                              <SelectTrigger className="flex-1"><SelectValue placeholder="Select ingredient" /></SelectTrigger>
                              <SelectContent>{(ingredients as any[]).map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent>
                            </Select>
                            <Input className="w-24" type="number" min="0.001" step="any" required value={recipe.quantity_required} onChange={(e) => setVariants((current) => current.map((row, index) => index === variantIndex ? { ...row, recipes: row.recipes.map((item, itemIndex) => itemIndex === recipeIndex ? { ...item, quantity_required: e.target.value } : item) } : row))} />
                            <span className="w-8 text-xs text-muted-foreground">{ingredient?.unit ?? "-"}</span>
                            <Button type="button" size="icon" variant="ghost" onClick={() => setVariants((current) => current.map((row, index) => index === variantIndex ? { ...row, recipes: row.recipes.filter((_, itemIndex) => itemIndex !== recipeIndex) } : row))}><Trash2 className="h-4 w-4" /></Button>
                          </div>;
                        })}
                        <div className="flex justify-between"><Button type="button" variant="outline" size="sm" onClick={() => setVariants((current) => current.map((row, index) => index === variantIndex ? { ...row, recipes: [...row.recipes, { item_id: "", quantity_required: "" }] } : row))}><Plus className="mr-1 h-4 w-4" /> Add ingredient</Button><Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={() => setVariants((current) => current.filter((_, index) => index !== variantIndex))}><Trash2 className="mr-1 h-4 w-4" /> Delete size</Button></div>
                      </div>)}
                    </div>}
                    <div className="sticky bottom-0 z-10 -mx-5 mt-4 border-t bg-background px-5 pb-1 pt-3 sm:-mx-6 sm:px-6">
                      <div className="flex justify-end gap-2">
                        <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                        <Button type="submit">Save</Button>
                      </div>
                    </div>
                  </form>
                </DialogContent>
              </Dialog>
            )}
          </div>
          <ProductTable title="Finished Goods (Direct Sale)" products={finishedPagination.paginatedItems} emptyMessage="No finished products found." isAdmin={isAdmin} onEdit={edit} onDelete={remove} />
          <ProductTable title="Recipe-Based Drinks" products={recipePagination.paginatedItems} emptyMessage="No recipe-based products found." isAdmin={isAdmin} onEdit={edit} onDelete={remove} variantTable recipeIngredients={safeIngredients} />
          <DataTablePagination {...finishedPagination} onPageChange={finishedPagination.setPage} />
          <DataTablePagination {...recipePagination} onPageChange={recipePagination.setPage} />
        </TabsContent>
        <TabsContent value="categories" className="space-y-3">
          <Card>
            <CardHeader><CardTitle className="font-display">Categories</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {isAdmin && (
                <form onSubmit={addCat} className="flex flex-col gap-2 sm:flex-row">
                  <Input placeholder="New category name" value={catName} onChange={e => setCatName(e.target.value)} className="sm:flex-1" />
                  <Select value={catType} onValueChange={(value) => setCatType(value as "Finished Good" | "recipe_based")}>
                    <SelectTrigger className="sm:w-52"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Finished Good">Finished Good</SelectItem>
                      <SelectItem value="recipe_based">recipe_based</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button type="submit">Add</Button>
                </form>
              )}
              <ul className="divide-y">
                {(categories as any[]).map(c => (
                  <li key={c.id} className="flex items-center justify-between py-2">
                    <div>
                      <div>{c.name}</div>
                      <div className="text-xs text-muted-foreground">{c.category_type ?? "Finished Good"}</div>
                    </div>
                    {isAdmin && (
                      <Button size="icon" variant="ghost" className="text-destructive" onClick={async () => { try { await delCat({ data: { id: c.id } }); toast.success("Deleted"); qc.invalidateQueries({ queryKey: ["categories"] }); } catch (e: any) { toast.error(e.message); } }}><Trash2 className="h-4 w-4" /></Button>
                    )}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="ingredients" className="space-y-3">
          <Card>
            <CardHeader><CardTitle className="font-display">Ingredients</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {isAdmin && <form onSubmit={addIngredient} className="grid gap-2 sm:grid-cols-5">
                <Input required placeholder="Ingredient Name" value={ingredientForm.name} onChange={(e) => setIngredientForm({ ...ingredientForm, name: e.target.value })} />
                <Select value={ingredientForm.unit} onValueChange={(unit) => setIngredientForm({ ...ingredientForm, unit })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["g", "ml", "pcs", "oz"].map((unit) => <SelectItem key={unit} value={unit}>{unit}</SelectItem>)}</SelectContent></Select>
                <Input required type="number" min="0" step="any" placeholder="Initial Stock" value={ingredientForm.initial_stock} onChange={(e) => setIngredientForm({ ...ingredientForm, initial_stock: e.target.value })} />
                <Input required type="number" min="0" step="any" placeholder="Low Stock Threshold" value={ingredientForm.low_stock_threshold} onChange={(e) => setIngredientForm({ ...ingredientForm, low_stock_threshold: e.target.value })} />
                <Button type="submit">Add</Button>
              </form>}
              <ul className="divide-y">{(ingredients as any[]).map((item) => <li key={item.id} className="flex items-center justify-between py-2"><span>{item.name} <span className="text-xs text-muted-foreground">({item.unit})</span></span>{isAdmin && <Button size="icon" variant="ghost" className="text-destructive" onClick={async () => { try { await delIngredient({ data: { id: item.id } }); qc.invalidateQueries({ queryKey: ["inventoryItems"] }); toast.success("Deleted"); } catch (e: any) { toast.error(e.message); } }}><Trash2 className="h-4 w-4" /></Button>}</li>)}</ul>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
