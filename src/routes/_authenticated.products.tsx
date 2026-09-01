import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listProducts, listCategories, listInventoryItems, listProductRecipes, listAllProductRecipes, upsertProduct, deleteProduct, upsertCategory, deleteCategory, upsertInventoryItem, deleteInventoryItem } from "@/lib/api/coffee.functions";
import { getMyRole } from "@/lib/api/users.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
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
const blank = { id: "", name: "", description: "", category_id: "", price: "", stock_quantity: "", low_stock_threshold: "10", image_url: "" };
type RecipeDraft = { item_id: string; quantity_required: string };

function Products() {
  const fn = useServerFn(listProducts);
  const catFn = useServerFn(listCategories);
  const ingredientFn = useServerFn(listInventoryItems);
  const recipeFn = useServerFn(listProductRecipes);
  const allRecipesFn = useServerFn(listAllProductRecipes);
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
  const { data: allRecipes = [] } = useQuery({ queryKey: ["productRecipes"], queryFn: () => allRecipesFn() });
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: () => fetchRole() });
  const isAdmin = !!me?.isAdmin;

  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [form, setForm] = useState(blank);
  const [catOpen, setCatOpen] = useState(false);
  const [catName, setCatName] = useState("");
  const [ingredientForm, setIngredientForm] = useState({ name: "", unit: "g", initial_stock: "", low_stock_threshold: "" });
  const [recipes, setRecipes] = useState<RecipeDraft[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const filteredProducts = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return products as any[];
    return (products as any[]).filter((product) =>
      product.name.toLowerCase().includes(query) ||
      product.categories?.name?.toLowerCase().includes(query),
    );
  }, [products, searchQuery]);
  const productsPagination = usePagination(filteredProducts);
  const hasRecipeIngredients = recipes.some((recipe) => recipe.item_id);
  const recipesByProduct = useMemo(() => {
    const grouped = new Map<string, any[]>();
    for (const recipe of allRecipes as any[]) {
      const current = grouped.get(recipe.product_id) ?? [];
      current.push(recipe);
      grouped.set(recipe.product_id, current);
    }
    return grouped;
  }, [allRecipes]);

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
    setRecipes((existing as any[]).map((recipe) => ({ item_id: recipe.item_id, quantity_required: String(recipe.quantity_required) })));
    setOpen(true);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload = {
        ...(form.id ? { id: form.id } : {}),
        name: form.name, description: form.description,
        category_id: form.category_id || null,
        price: Number(form.price),
        stock_quantity: form.stock_quantity === "" ? 0 : Number(form.stock_quantity),
        low_stock_threshold: Number(form.low_stock_threshold),
        image_url: form.image_url || null,
        recipes: recipes.filter((recipe) => recipe.item_id && Number(recipe.quantity_required) > 0).map((recipe) => ({
          item_id: recipe.item_id,
          quantity_required: Number(recipe.quantity_required),
        })),
      };

      await save({ data: payload });
      toast.success("Product saved");
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["productRecipes"] });
      setOpen(false); setForm(blank);
      setRecipes([]);
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
      await saveCat({ data: { name: catName } });
      toast.success("Category added");
      setCatName("");
      qc.invalidateQueries({ queryKey: ["categories"] });
    }
    catch (e: any) { toast.error(e.message); }
  };

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
              <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setForm(blank); setRecipes([]); } }}>
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
                        <SelectContent>{(categories as any[]).map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5"><Label>Price</Label><Input type="number" step="0.01" min="0" required value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} /></div>
                      <div className="space-y-1.5"><Label>Stock Qty{hasRecipeIngredients ? " (optional)" : ""}</Label><Input type="number" min="0" required={!hasRecipeIngredients} disabled={hasRecipeIngredients} value={form.stock_quantity} onChange={e => setForm({ ...form, stock_quantity: e.target.value })} /></div>
                      <div className="space-y-1.5"><Label>Low Stock Alert{hasRecipeIngredients ? " (optional)" : ""}</Label><Input type="number" min="0" required={!hasRecipeIngredients} disabled={hasRecipeIngredients} value={form.low_stock_threshold} onChange={e => setForm({ ...form, low_stock_threshold: e.target.value })} /></div>
                    </div>
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
                    <div className="space-y-2 border-t pt-3">
                      <Label>Recipe / Ingredients</Label>
                      {recipes.map((recipe, index) => {
                        const ingredient = (ingredients as any[]).find((item) => item.id === recipe.item_id);
                        return <div key={`${recipe.item_id}-${index}`} className="flex items-center gap-2">
                          <Select value={recipe.item_id} onValueChange={(value) => setRecipes((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, item_id: value } : row))}>
                            <SelectTrigger className="flex-1"><SelectValue placeholder="Select ingredient" /></SelectTrigger>
                            <SelectContent>{(ingredients as any[]).map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent>
                          </Select>
                          <Input className="w-24" type="number" min="0.001" step="any" required value={recipe.quantity_required} onChange={(e) => setRecipes((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, quantity_required: e.target.value } : row))} />
                          <span className="w-8 text-xs text-muted-foreground">{ingredient?.unit ?? "-"}</span>
                          <Button type="button" size="icon" variant="ghost" onClick={() => setRecipes((current) => current.filter((_, rowIndex) => rowIndex !== index))}><Trash2 className="h-4 w-4" /></Button>
                        </div>;
                      })}
                      <Button type="button" variant="outline" onClick={() => setRecipes((current) => [...current, { item_id: "", quantity_required: "" }])}><Plus className="mr-1 h-4 w-4" /> Add ingredient</Button>
                    </div>
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
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Image</TableHead>
                    <TableHead>Name</TableHead><TableHead>Category</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                    {/* <TableHead className="text-right">Cost</TableHead> */}
                    <TableHead>Recipe / Ingredients</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {productsPagination.paginatedItems.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="h-24 text-center">No products found.</TableCell>
                    </TableRow>
                  ) : productsPagination.paginatedItems.map(p => (
                    <TableRow key={p.id}>
                      <TableCell><ProductImage path={p.image_url} className="h-10 w-10 rounded-md border" /></TableCell>
                      <TableCell className="font-medium">{p.name}</TableCell>
                      <TableCell>{p.categories?.name ?? "—"}</TableCell>
                      <TableCell className="text-right">{peso(p.price)}</TableCell>
                      {/* <TableCell className="text-right">{peso(p.cost)}</TableCell> */}
                      <TableCell>
                        {(recipesByProduct.get(p.id) ?? []).length > 0
                          ? recipesByProduct.get(p.id)!.map((recipe: any) => `${recipe.inventory_items?.name ?? "Unknown"} (${recipe.quantity_required} ${recipe.inventory_items?.unit ?? ""})`).join(", ")
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {isAdmin && (
                          <>
                            <Button size="icon" variant="ghost" onClick={() => edit(p)}><Pencil className="h-4 w-4" /></Button>
                            <AlertDialog>
                              <AlertDialogTrigger asChild><Button size="icon" variant="ghost" className="text-destructive"><Trash2 className="h-4 w-4" /></Button></AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader><AlertDialogTitle>Delete {p.name}?</AlertDialogTitle><AlertDialogDescription>This cannot be undone.</AlertDialogDescription></AlertDialogHeader>
                                <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => remove(p.id)}>Delete</AlertDialogAction></AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <DataTablePagination {...productsPagination} onPageChange={productsPagination.setPage} />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="categories" className="space-y-3">
          <Card>
            <CardHeader><CardTitle className="font-display">Categories</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {isAdmin && (
                <form onSubmit={addCat} className="flex gap-2">
                  <Input placeholder="New category name" value={catName} onChange={e => setCatName(e.target.value)} />
                  <Button type="submit">Add</Button>
                </form>
              )}
              <ul className="divide-y">
                {(categories as any[]).map(c => (
                  <li key={c.id} className="flex items-center justify-between py-2">
                    <span>{c.name}</span>
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
