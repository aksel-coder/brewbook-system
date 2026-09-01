import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listProducts, listInventoryItems, adjustIngredient, adjustInventory, listInventoryMovements } from "@/lib/api/coffee.functions";
import { getMyRole } from "@/lib/api/users.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { DataTablePagination } from "@/components/data-table-pagination";
import { usePagination } from "@/hooks/use-pagination";

export const Route = createFileRoute("/_authenticated/inventory")({
  head: () => ({ meta: [{ title: "Inventory — Coffee Zone" }] }),
  component: Inventory,
});

function Inventory() {
  const productsFn = useServerFn(listProducts);
  const fn = useServerFn(listInventoryItems);
  const txnFn = useServerFn(listInventoryMovements);
  const adjust = useServerFn(adjustIngredient);
  const adjustProduct = useServerFn(adjustInventory);
  const fetchRole = useServerFn(getMyRole);
  const qc = useQueryClient();
  const { data: products = [] } = useQuery({ queryKey: ["products"], queryFn: () => productsFn() });
  const { data: items = [] } = useQuery({ queryKey: ["inventoryItems"], queryFn: () => fn() });
  const { data: txns = [] } = useQuery({ queryKey: ["inventoryMovements"], queryFn: () => txnFn() });
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: () => fetchRole() });
  const isAdmin = !!me?.isAdmin;
  const stockRows = useMemo(() => [
    ...(items as any[]).map((item) => ({
      ...item,
      kind: "ingredient",
      category: "Raw Ingredient",
    })),
    ...(products as any[]).map((product) => ({
      ...product,
      id: `product-${product.id}`,
      kind: "product",
      category: product.categories?.name ?? "—",
      display_id: product.id,
    })),
  ], [items, products]);
  const stockPagination = usePagination(stockRows);
  const txnPagination = usePagination(txns as any[]);

  const [open, setOpen] = useState(false);
  const [itemId, setItemId] = useState("");
  const [type, setType] = useState<"In" | "Out" | "Waste">("In");
  const [qty, setQty] = useState("");
  const [ref, setRef] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const selectedItem = stockRows.find((item: any) => item.id === itemId);
      if (!selectedItem) throw new Error("Please select an inventory item");

      const result = selectedItem.kind === "ingredient"
        ? await adjust({
          data: { item_id: selectedItem.id, quantity: Number(qty), type, reference: ref },
        })
        : await adjustProduct({
          data: {
            product_id: selectedItem.display_id,
            quantity: Number(qty),
            transaction_type: type === "In" ? "in" : type === "Out" || type === "Waste" ? "out" : "adjust",
            reference: ref,
          },
        });

      if (!result?.ok) {
        throw new Error("Inventory update did not persist to Supabase");
      }

      toast.success("Inventory updated");
      qc.invalidateQueries({ queryKey: ["inventoryItems"] });
      qc.invalidateQueries({ queryKey: ["inventoryMovements"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["sales"] });
      setOpen(false); setItemId(""); setQty(""); setRef("");
    } catch (e: any) { toast.error(e.message); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-3xl font-bold">Inventory</h1>
        {isAdmin && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button>Adjust Stock</Button></DialogTrigger>
            <DialogContent className="overflow-y-auto">
              <DialogHeader><DialogTitle>Adjust Stock</DialogTitle></DialogHeader>
              <form onSubmit={submit} className="space-y-3">
                <div className="space-y-1.5">
                  <Label>Inventory Item</Label>
                  <Select value={itemId} onValueChange={setItemId}>
                    <SelectTrigger><SelectValue placeholder="Select item" /></SelectTrigger>
                    <SelectContent>{stockRows.map((item: any) => <SelectItem key={item.id} value={item.id}>{item.name} ({item.kind === "ingredient" ? `stock: ${item.current_stock} ${item.unit}` : `stock: ${item.stock_quantity} pcs`})</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Type</Label>
                  <Select value={type} onValueChange={(v: any) => setType(v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="In">Stock In (add)</SelectItem>
                      <SelectItem value="Out">Stock Out (remove)</SelectItem>
                      <SelectItem value="Waste">Waste (remove)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Quantity</Label>
                  <Input type="number" min="0" required value={qty} onChange={e => setQty(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Reference (optional)</Label>
                  <Input value={ref} onChange={e => setRef(e.target.value)} placeholder="e.g. PO #1234" />
                </div>
                <div className="sticky bottom-0 z-10 -mx-5 mt-4 border-t bg-background px-5 pb-1 pt-3 sm:-mx-6 sm:px-6">
                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                    <Button type="submit" disabled={!itemId || !qty}>Save</Button>
                  </div>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <Card>
        <CardHeader><CardTitle className="font-display">Stock Levels</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item Name</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Initial Stock / Stock Qty</TableHead>
                <TableHead className="text-right">Used</TableHead>
                <TableHead className="text-right">Remaining Stock</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stockPagination.paginatedItems.map((item: any) => {
                const isIngredient = item.kind === "ingredient";
                const remainingStock = isIngredient ? item.current_stock : item.stock_quantity;
                const low = Number(remainingStock) <= Number(item.low_stock_threshold ?? 0);
                return (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.name}</TableCell>
                    <TableCell>{item.category}</TableCell>
                    <TableCell className="text-right">{isIngredient ? item.initial_stock : "—"}</TableCell>
                    <TableCell className="text-right">{isIngredient ? item.total_used : "—"}</TableCell>
                    <TableCell className="text-right">{remainingStock}</TableCell>
                    <TableCell>{isIngredient ? item.unit : "pcs"}</TableCell>
                    <TableCell>
                      <Badge variant={low ? "destructive" : "secondary"}>
                        {low ? "Low Stock" : "Healthy"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <DataTablePagination {...stockPagination} onPageChange={stockPagination.setPage} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="font-display">Recent Movements</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Item</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead>Reference</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {txnPagination.paginatedItems.map((t: any) => (
                <TableRow key={t.id}>
                  <TableCell className="text-xs">{new Date(t.created_at).toLocaleString()}</TableCell>
                  <TableCell>{t.item_name ?? t.inventory_items?.name ?? "—"}</TableCell>
                  <TableCell><Badge variant="outline" className="capitalize">{t.type}</Badge></TableCell>
                  <TableCell className={`text-right font-medium ${t.qty < 0 ? "text-destructive" : "text-success"}`}>{t.qty > 0 ? "+" : ""}{t.qty} {t.unit ?? t.inventory_items?.unit}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{t.reference}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <DataTablePagination {...txnPagination} onPageChange={txnPagination.setPage} />
        </CardContent>
      </Card>
    </div>
  );
}
