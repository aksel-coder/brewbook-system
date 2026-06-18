import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listProducts, createSale } from "@/lib/api/coffee.functions";
import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Minus, Trash2, Search, Printer, X, ImageIcon } from "lucide-react";
import { toast } from "sonner";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import logo from "@/assets/coffee-zone-logo.jpg.asset.json";

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
  if (!url) return <div className={`flex items-center justify-center bg-secondary text-muted-foreground ${className ?? ""}`}><ImageIcon className="h-6 w-6" /></div>;
  return <img src={url} alt="" className={`object-cover ${className ?? ""}`} />;
}

export const Route = createFileRoute("/_authenticated/sales/")({
  head: () => ({ meta: [{ title: "POS — Coffee Zone" }] }),
  component: SalesPOS,
});

const peso = (n: number) => "₱" + Number(n).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type CartItem = { product_id: string; name: string; price: number; quantity: number; stock: number };

function SalesPOS() {
  const fn = useServerFn(listProducts);
  const createFn = useServerFn(createSale);
  const qc = useQueryClient();
  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: () => fn(),
  });
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [receipt, setReceipt] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  const filtered = useMemo(() =>
    (products as any[]).filter(p => p.is_active && p.name.toLowerCase().includes(search.toLowerCase())),
    [products, search]);

  const addToCart = (p: any) => {
    if (p.stock_quantity <= 0) return toast.error("Out of stock");
    setCart(prev => {
      const ex = prev.find(c => c.product_id === p.id);
      if (ex) {
        if (ex.quantity >= p.stock_quantity) { toast.error("No more stock"); return prev; }
        return prev.map(c => c.product_id === p.id ? { ...c, quantity: c.quantity + 1 } : c);
      }
      return [...prev, { product_id: p.id, name: p.name, price: Number(p.price), quantity: 1, stock: p.stock_quantity }];
    });
  };

  const adjust = (id: string, delta: number) => setCart(prev =>
    prev.map(c => c.product_id === id ? { ...c, quantity: Math.max(1, Math.min(c.stock, c.quantity + delta)) } : c)
  );
  const remove = (id: string) => setCart(prev => prev.filter(c => c.product_id !== id));

  const subtotal = cart.reduce((s, c) => s + c.price * c.quantity, 0);
  const tax = +(subtotal * 0.12).toFixed(2);
  const total = +(subtotal + tax).toFixed(2);

  const checkout = async () => {
    if (cart.length === 0) return;
    setBusy(true);
    try {
      const items = cart.map(c => ({ product_id: c.product_id, quantity: c.quantity, unit_price: c.price }));
      const res = await createFn({ data: { items, tax_rate: 0.12 } });
      setReceipt({ ...res, items: cart, ts: new Date() });
      setCart([]);
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["sales"] });
      qc.invalidateQueries({ queryKey: ["inventoryTxns"] });
      toast.success(`Sale recorded · ${res.sale.receipt_number}`);
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-2">
        <div>
          <h1 className="font-display text-3xl font-bold">Point of Sale</h1>
          <p className="text-sm text-muted-foreground">Select products to add to cart.</p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Search products..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {filtered.map((p: any) => (
              <button key={p.id} onClick={() => addToCart(p)} disabled={p.stock_quantity === 0}
                className="group rounded-xl border bg-card p-4 text-left transition hover:border-primary hover:shadow-md disabled:opacity-40">
                <ProductImage path={p.image_url} className="h-40 w-full rounded-md" />
                <div className="mt-3 font-medium">{p.name}</div>
                <div className="text-xs text-muted-foreground">{p.categories?.name}</div>
                <div className="mt-2 flex items-center justify-between">
                  <span className="font-semibold text-primary">{peso(p.price)}</span>
                  <Badge variant={p.stock_quantity <= p.low_stock_threshold ? "destructive" : "secondary"}>{p.stock_quantity}</Badge>
                </div>
              </button>
            ))}
          </div>
        </div>

        <Card className="lg:sticky lg:top-20 h-fit">
          <CardHeader><CardTitle className="font-display">Cart ({cart.length})</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {cart.length === 0 ? <p className="text-sm text-muted-foreground">Empty cart</p> :
              <ul className="space-y-2 max-h-64 overflow-auto">
                {cart.map(c => (
                  <li key={c.product_id} className="flex items-center gap-2 rounded-md border p-2">
                    <div className="flex-1">
                      <div className="text-sm font-medium">{c.name}</div>
                      <div className="text-xs text-muted-foreground">{peso(c.price)} each</div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => adjust(c.product_id, -1)}><Minus className="h-3 w-3" /></Button>
                      <span className="w-6 text-center text-sm">{c.quantity}</span>
                      <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => adjust(c.product_id, 1)}><Plus className="h-3 w-3" /></Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => remove(c.product_id)}><Trash2 className="h-3 w-3" /></Button>
                    </div>
                  </li>
                ))}
              </ul>}
            <div className="space-y-1 border-t pt-3 text-sm">
              {/* <div className="flex justify-between"><span>Subtotal</span><span>{peso(subtotal)}</span></div> */}
              <div className="flex justify-between font-display text-lg font-bold"><span>Total</span><span>{peso(subtotal)}</span></div>
            </div>
            <Button className="w-full" size="lg" disabled={cart.length === 0 || busy} onClick={checkout}>
              {busy ? "Processing..." : "Checkout"}
            </Button>
          </CardContent>
        </Card>
      </div>

      <Dialog open={!!receipt} onOpenChange={(o) => !o && setReceipt(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Receipt</DialogTitle></DialogHeader>
          {receipt && (
            <>
              <div className="print-area bg-white p-4 text-black">
                <div className="flex flex-col items-center text-center">
                  <img src={'/coffeLogo.jpg'} className="h-16 w-16 rounded-full" alt="logo" />
                  <div className="mt-2 font-display text-xl font-bold">COFFEE ZONE</div>
                  <div className="text-xs">Start your day right</div>
                </div>
                <div className="my-3 border-y border-dashed py-2 text-center text-xs">
                  <div>{receipt.sale.receipt_number}</div>
                  <div>{new Date(receipt.ts).toLocaleString()}</div>
                </div>
                <table className="w-full text-xs">
                  <tbody>
                    {receipt.items.map((i: CartItem) => (
                      <tr key={i.product_id}>
                        <td>{i.quantity}× {i.name}</td>
                        <td className="text-right">{peso(i.price * i.quantity)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="mt-3 space-y-0.5 border-t border-dashed pt-2 text-xs">
                  {/* <div className="flex justify-between"><span>Subtotal</span><span>{peso(receipt.subtotal)}</span></div> */}
                  <div className="flex justify-between font-bold"><span>TOTAL</span><span>{peso(receipt.subtotal)}</span></div>
                </div>
                <div className="mt-3 text-center text-xs">Thank you! ☕</div>
              </div>
              <div className="flex gap-2 no-print">
                <Button variant="outline" className="flex-1" onClick={() => setReceipt(null)}><X className="mr-1 h-4 w-4" /> Close</Button>
                <Button className="flex-1" onClick={() => window.print()}><Printer className="mr-1 h-4 w-4" /> Print</Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
