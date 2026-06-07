import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listProducts, adjustInventory, listInventoryTxns } from "@/lib/api/coffee.functions";
import { loadInventoryTxns, loadProducts, mutateInventory } from "@/lib/offline/data-access";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/inventory")({
  head: () => ({ meta: [{ title: "Inventory — Coffee Zone" }] }),
  component: Inventory,
});

function Inventory() {
  const fn = useServerFn(listProducts);
  const txnFn = useServerFn(listInventoryTxns);
  const adjust = useServerFn(adjustInventory);
  const qc = useQueryClient();
  const { data: products = [] } = useQuery({ queryKey: ["products"], queryFn: () => loadProducts(() => fn()) });
  const { data: txns = [] } = useQuery({ queryKey: ["inventoryTxns"], queryFn: () => loadInventoryTxns(() => txnFn()) });

  const [open, setOpen] = useState(false);
  const [pid, setPid] = useState("");
  const [type, setType] = useState<"in" | "out" | "adjust">("in");
  const [qty, setQty] = useState("");
  const [ref, setRef] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await mutateInventory(
        (input) => adjust(input),
        { product_id: pid, quantity: Number(qty), transaction_type: type, reference: ref },
      ) as any;
      toast.success(res?.offline ? "Saved offline — will sync when online" : "Inventory updated");
      qc.invalidateQueries({ queryKey: ["offline-pending"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["inventoryTxns"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      setOpen(false); setPid(""); setQty(""); setRef("");
    } catch (e: any) { toast.error(e.message); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-3xl font-bold">Inventory</h1>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button>Adjust Stock</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Adjust Stock</DialogTitle></DialogHeader>
            <form onSubmit={submit} className="space-y-3">
              <div className="space-y-1.5">
                <Label>Product</Label>
                <Select value={pid} onValueChange={setPid}>
                  <SelectTrigger><SelectValue placeholder="Select product" /></SelectTrigger>
                  <SelectContent>{(products as any[]).map(p => <SelectItem key={p.id} value={p.id}>{p.name} (stock: {p.stock_quantity})</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Type</Label>
                <Select value={type} onValueChange={(v: any) => setType(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="in">Stock In (add)</SelectItem>
                    <SelectItem value="out">Stock Out (remove)</SelectItem>
                    <SelectItem value="adjust">Set Exact Quantity</SelectItem>
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
              <Button type="submit" className="w-full" disabled={!pid || !qty}>Save</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader><CardTitle className="font-display">Stock Levels</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Stock</TableHead>
                <TableHead className="text-right">Threshold</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(products as any[]).map(p => {
                const low = p.stock_quantity <= p.low_stock_threshold;
                const out = p.stock_quantity === 0;
                return (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell>{p.categories?.name ?? "—"}</TableCell>
                    <TableCell className="text-right">{p.stock_quantity}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{p.low_stock_threshold}</TableCell>
                    <TableCell>
                      <Badge variant={out ? "destructive" : low ? "destructive" : "secondary"}>
                        {out ? "Out of stock" : low ? "Low" : "Healthy"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="font-display">Recent Movements</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Product</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead>Reference</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(txns as any[]).slice(0, 50).map((t: any) => (
                <TableRow key={t.id}>
                  <TableCell className="text-xs">{new Date(t.created_at).toLocaleString()}</TableCell>
                  <TableCell>{t.products?.name}</TableCell>
                  <TableCell><Badge variant="outline" className="capitalize">{t.transaction_type}</Badge></TableCell>
                  <TableCell className={`text-right font-medium ${t.quantity < 0 ? "text-destructive" : "text-success"}`}>{t.quantity > 0 ? "+" : ""}{t.quantity}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{t.reference}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
