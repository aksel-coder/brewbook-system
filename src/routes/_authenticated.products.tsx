import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listProducts, listCategories, upsertProduct, deleteProduct, upsertCategory, deleteCategory } from "@/lib/api/coffee.functions";
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
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

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
const blank = { id: "", name: "", description: "", category_id: "", price: "", cost: "", stock_quantity: "", low_stock_threshold: "10", image_url: "" };

function Products() {
  const fn = useServerFn(listProducts);
  const catFn = useServerFn(listCategories);
  const save = useServerFn(upsertProduct);
  const del = useServerFn(deleteProduct);
  const saveCat = useServerFn(upsertCategory);
  const delCat = useServerFn(deleteCategory);
  const qc = useQueryClient();

  const { data: products = [] } = useQuery({ queryKey: ["products"], queryFn: () => fn() });
  const { data: categories = [] } = useQuery({ queryKey: ["categories"], queryFn: () => catFn() });

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(blank);
  const [catOpen, setCatOpen] = useState(false);
  const [catName, setCatName] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

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

  const edit = (p: any) => {
    setForm({
      id: p.id, name: p.name, description: p.description ?? "",
      category_id: p.category_id ?? "", price: String(p.price), cost: String(p.cost),
      stock_quantity: String(p.stock_quantity), low_stock_threshold: String(p.low_stock_threshold),
      image_url: p.image_url ?? "",
    });
    setOpen(true);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await save({ data: {
        ...(form.id ? { id: form.id } : {}),
        name: form.name, description: form.description,
        category_id: form.category_id || null,
        price: Number(form.price), cost: Number(form.cost),
        stock_quantity: Number(form.stock_quantity),
        low_stock_threshold: Number(form.low_stock_threshold),
        image_url: form.image_url || null,
      }});
      toast.success("Product saved");
      qc.invalidateQueries({ queryKey: ["products"] });
      setOpen(false); setForm(blank);
    } catch (e: any) { toast.error(e.message); }
  };

  const remove = async (id: string) => {
    try { await del({ data: { id } }); toast.success("Deleted"); qc.invalidateQueries({ queryKey: ["products"] }); }
    catch (e: any) { toast.error(e.message); }
  };

  const addCat = async (e: React.FormEvent) => {
    e.preventDefault();
    try { await saveCat({ data: { name: catName } }); toast.success("Category added"); setCatName(""); qc.invalidateQueries({ queryKey: ["categories"] }); }
    catch (e: any) { toast.error(e.message); }
  };

  return (
    <div className="space-y-4">
      <h1 className="font-display text-3xl font-bold">Products</h1>
      <Tabs defaultValue="products">
        <TabsList>
          <TabsTrigger value="products">Products</TabsTrigger>
          <TabsTrigger value="categories">Categories</TabsTrigger>
        </TabsList>
        <TabsContent value="products" className="space-y-3">
          <div className="flex justify-end">
            <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setForm(blank); }}>
              <DialogTrigger asChild><Button><Plus className="mr-1 h-4 w-4" /> New Product</Button></DialogTrigger>
              <DialogContent>
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
                    <div className="space-y-1.5"><Label>Cost</Label><Input type="number" step="0.01" min="0" required value={form.cost} onChange={e => setForm({ ...form, cost: e.target.value })} /></div>
                    <div className="space-y-1.5"><Label>Stock Qty</Label><Input type="number" min="0" required value={form.stock_quantity} onChange={e => setForm({ ...form, stock_quantity: e.target.value })} /></div>
                    <div className="space-y-1.5"><Label>Low Stock Alert</Label><Input type="number" min="0" required value={form.low_stock_threshold} onChange={e => setForm({ ...form, low_stock_threshold: e.target.value })} /></div>
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
                  <Button type="submit" className="w-full">Save</Button>
                </form>
              </DialogContent>
            </Dialog>
          </div>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead><TableHead>Category</TableHead>
                    <TableHead className="text-right">Price</TableHead><TableHead className="text-right">Cost</TableHead>
                    <TableHead className="text-right">Stock</TableHead><TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(products as any[]).map(p => (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">{p.name}</TableCell>
                      <TableCell>{p.categories?.name ?? "—"}</TableCell>
                      <TableCell className="text-right">{peso(p.price)}</TableCell>
                      <TableCell className="text-right">{peso(p.cost)}</TableCell>
                      <TableCell className="text-right">{p.stock_quantity}</TableCell>
                      <TableCell className="text-right">
                        <Button size="icon" variant="ghost" onClick={() => edit(p)}><Pencil className="h-4 w-4" /></Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild><Button size="icon" variant="ghost" className="text-destructive"><Trash2 className="h-4 w-4" /></Button></AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader><AlertDialogTitle>Delete {p.name}?</AlertDialogTitle><AlertDialogDescription>This cannot be undone.</AlertDialogDescription></AlertDialogHeader>
                            <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => remove(p.id)}>Delete</AlertDialogAction></AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="categories" className="space-y-3">
          <Card>
            <CardHeader><CardTitle className="font-display">Categories</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <form onSubmit={addCat} className="flex gap-2">
                <Input placeholder="New category name" value={catName} onChange={e => setCatName(e.target.value)} />
                <Button type="submit">Add</Button>
              </form>
              <ul className="divide-y">
                {(categories as any[]).map(c => (
                  <li key={c.id} className="flex items-center justify-between py-2">
                    <span>{c.name}</span>
                    <Button size="icon" variant="ghost" className="text-destructive" onClick={async () => { try { await delCat({ data: { id: c.id } }); toast.success("Deleted"); qc.invalidateQueries({ queryKey: ["categories"] }); } catch (e: any) { toast.error(e.message); } }}><Trash2 className="h-4 w-4" /></Button>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
