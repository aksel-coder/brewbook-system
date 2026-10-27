import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listProducts, listInventoryItems, createSale } from "@/lib/api/coffee.functions";
import { getMyRole } from "@/lib/api/users.functions";
import {
  cacheOfflineProducts,
  commitOfflineSale,
  forgetVerifiedAdmin,
  getOfflineInventory,
  getOfflineProducts,
  hasVerifiedAdmin,
  rememberVerifiedAdmin,
  type OfflineSale,
} from "@/lib/offline";
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
import { escapeHtml, printHtmlDocument } from "@/lib/print";

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

type CartItem = { product_id: string; variant_id?: string; name: string; variant_name?: string; price: number; quantity: number; stock: number };

const clearPersistedPosState = () => {
  if (typeof window === "undefined") return;
  try {
    const keys = ["coffee-zone-cart", "coffee-zone-selected-products", "pos-cart", "selectedProducts"];
    for (const key of keys) window.localStorage.removeItem(key);
  } catch {
    // ignore storage access failures during startup
  }
};

function SalesPOS() {
  const fn = useServerFn(listProducts);
  const inventoryFn = useServerFn(listInventoryItems);
  const createFn = useServerFn(createSale);
  const roleFn = useServerFn(getMyRole);
  const qc = useQueryClient();
  const [ownerId, setOwnerId] = useState("");
  const [offlineEligible, setOfflineEligible] = useState(false);
  const [isOnline, setIsOnline] = useState(typeof navigator === "undefined" || navigator.onLine);
  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: async () => {
      if (!navigator.onLine) {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session || !(await hasVerifiedAdmin(session.user.id))) {
          throw new Error("Offline POS is available only to an Admin who previously signed in online.");
        }
        const cached = await getOfflineProducts(session.user.id);
        if (!cached) throw new Error("No cached products. Connect to the internet and open POS before going offline.");
        return cached;
      }
      const rows = await fn();
      const inventory = await inventoryFn();
      if (ownerId && await hasVerifiedAdmin(ownerId)) {
        await cacheOfflineProducts(ownerId, rows, inventory);
      }
      return rows;
    },
  });
  const [inventory, setInventory] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [receipt, setReceipt] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [variantProduct, setVariantProduct] = useState<any>(null);

  useEffect(() => {
    clearPersistedPosState();
    const updateNetwork = () => setIsOnline(navigator.onLine);
    window.addEventListener("online", updateNetwork);
    window.addEventListener("offline", updateNetwork);
    void supabase.auth.getSession().then(async ({ data: { session } }) => {
      const id = session?.user.id ?? "";
      setOwnerId(id);
      if (!id) return;
      setOfflineEligible(await hasVerifiedAdmin(id));
      const cachedInventory = await getOfflineInventory(id);
      if (cachedInventory) setInventory(cachedInventory);
      if (navigator.onLine) {
        try {
          const role = await roleFn();
          if (!role.isAdmin) {
            await forgetVerifiedAdmin(id);
            setOfflineEligible(false);
            return;
          }
          await rememberVerifiedAdmin(id);
          setOfflineEligible(true);
          const rows = await fn();
          const freshInventory = await inventoryFn();
          setInventory(freshInventory);
          await cacheOfflineProducts(id, rows, freshInventory);
        } catch (error) {
          console.error("Could not refresh the offline POS catalog:", error);
        }
      }
    });
    return () => {
      window.removeEventListener("online", updateNetwork);
      window.removeEventListener("offline", updateNetwork);
    };
  }, [fn, inventoryFn, roleFn]);

  const safeProducts = Array.isArray(products) ? products.filter(Boolean) : [];
  const filtered = useMemo(() =>
    safeProducts.filter((p: any) => p?.is_active && typeof p?.name === "string" && p.name.toLowerCase().includes(search.toLowerCase())),
    [safeProducts, search]);

  const addToCart = (p: any, variant?: any) => {
    const isRecipeBased = p.inventory_type === "recipe_based";
    if (!variant && isRecipeBased && (p.product_variants?.length ?? 0) > 0) {
      setVariantProduct(p);
      return;
    }
    if (!isRecipeBased && p.available_stock <= 0) return toast.error("Out of stock");
    const cartId = variant?.id ?? p.id;
    setCart(prev => {
      const ex = prev.find(c => c.product_id === p.id && c.variant_id === variant?.id);
      if (ex) {
        if (!isRecipeBased && ex.quantity >= p.available_stock) { toast.error("No more stock"); return prev; }
        return prev.map(c => c.product_id === p.id && c.variant_id === variant?.id ? { ...c, quantity: c.quantity + 1 } : c);
      }
      return [...prev, { product_id: p.id, variant_id: variant?.id, name: p.name, variant_name: variant?.name, price: Number(variant?.price ?? p.price), quantity: 1, stock: isRecipeBased ? Number.MAX_SAFE_INTEGER : p.available_stock }];
    });
    setVariantProduct(null);
  };

  const adjust = (item: CartItem, delta: number) => setCart(prev =>
    prev.map(c => c.product_id === item.product_id && c.variant_id === item.variant_id ? { ...c, quantity: Math.max(1, Math.min(c.stock, c.quantity + delta)) } : c)
  );
  const remove = (item: CartItem) => setCart(prev => prev.filter(c => c.product_id !== item.product_id || c.variant_id !== item.variant_id));

  const subtotal = cart.reduce((s, c) => s + c.price * c.quantity, 0);
  const total = subtotal;

  const checkout = async () => {
    if (cart.length === 0) return;
    setBusy(true);
    try {
      if (!isOnline) {
        await finishOfflineCheckout();
        return;
      }
      const items = cart.map(c => ({ product_id: c.product_id, ...(c.variant_id ? { variant_id: c.variant_id } : {}), quantity: c.quantity }));
      const res = await createFn({ data: { items } });
      setReceipt({ ...res, ts: new Date() });
      setCart([]);
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["sales"] });
      qc.invalidateQueries({ queryKey: ["inventoryTxns"] });
      qc.invalidateQueries({ queryKey: ["inventoryItems"] });
      qc.invalidateQueries({ queryKey: ["inventoryMovements"] });
      toast.success(`Sale recorded · ${res.sale.receipt_number}`);
    } catch (e: any) {
      if (!navigator.onLine) {
        try {
          await finishOfflineCheckout();
        } catch (offlineError) {
          toast.error(offlineError instanceof Error ? offlineError.message : String(offlineError));
        }
      } else {
        toast.error(e.message);
      }
    }
    finally { setBusy(false); }
  };

  const printReceipt = async () => {
    try {
      const logoUrl = new URL("/coffee-zone-logo.png", window.location.href).href;
      const items = (receipt.items as CartItem[])
        .map((item) => {
          const itemName = `${escapeHtml(item.name)}${item.variant_name ? ` <span class="variant">${escapeHtml(item.variant_name)}</span>` : ""}`;
          return `<tr>
            <td class="item">${itemName}</td>
            <td class="quantity">${item.quantity}</td>
            <td class="price">${peso(item.price)}</td>
            <td class="amount">${peso(item.price * item.quantity)}</td>
          </tr>`;
        })
        .join("");
      const date = escapeHtml(new Date(receipt.ts).toLocaleString());
      const pendingSync = receipt.offline
        ? '<p class="pending-sync">Pending Sync</p>'
        : "";
      const html = `<!doctype html>
        <html>
          <head>
            <meta charset="utf-8" />
            <title>Receipt ${escapeHtml(receipt.sale.receipt_number)}</title>
            <style>
              @page { margin: 0; }
              * { box-sizing: border-box; }
              html, body { margin: 0; padding: 0; width: 80mm; }
              body { color: #000; background: #fff; font-family: Arial, sans-serif; font-size: 10px; }
              .receipt { width: 80mm; padding: 3mm; }
              .header { display: flex; align-items: center; justify-content: space-between; gap: 3mm; margin-bottom: 3mm; break-inside: avoid; page-break-inside: avoid; }
              .branding { min-width: 0; }
              .business-name { font-size: 15px; line-height: 1.15; font-weight: 700; }
              .tagline { margin-top: 1mm; font-size: 9px; }
              .logo { display: block; flex: 0 0 16mm; width: 16mm; height: 16mm; object-fit: contain; }
              .receipt-meta { padding: 2mm 0; border-top: 1px dashed #555; border-bottom: 1px dashed #555; text-align: center; line-height: 1.4; overflow-wrap: anywhere; break-inside: avoid; page-break-inside: avoid; }
              .pending-sync { margin: 1mm 0 0; font-weight: 700; }
              table { width: 100%; margin-top: 2mm; border-collapse: collapse; table-layout: fixed; }
              thead { display: table-header-group; }
              th { padding: 1mm 0; border-bottom: 1px solid #777; font-size: 9px; text-align: left; }
              td { padding: 1.5mm 0; vertical-align: top; }
              tr { break-inside: avoid; page-break-inside: avoid; }
              .item { width: 43%; overflow-wrap: anywhere; }
              .variant { display: block; font-size: 9px; }
              .quantity { width: 10%; text-align: center; }
              .price, .amount { width: 23.5%; text-align: right; white-space: nowrap; }
              .total { display: flex; justify-content: space-between; gap: 3mm; margin-top: 2mm; padding-top: 2mm; border-top: 1px dashed #555; font-size: 12px; font-weight: 700; break-inside: avoid; page-break-inside: avoid; }
              .closing { margin-top: 3mm; text-align: center; break-inside: avoid; page-break-inside: avoid; }
              @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
            </style>
          </head>
          <body>
            <main class="receipt">
              <header class="header">
                <div class="branding">
                  <div class="business-name">COFFEE ZONE</div>
                  <div class="tagline">Start your day right</div>
                </div>
                <img class="logo" src="${escapeHtml(logoUrl)}" alt="Coffee Zone logo" />
              </header>
              <section class="receipt-meta">
                <div>Receipt: ${escapeHtml(receipt.sale.receipt_number)}</div>
                <div>${date}</div>
                ${pendingSync}
              </section>
              <table>
                <thead><tr><th>Item</th><th class="quantity">Qty</th><th class="price">Price</th><th class="amount">Amount</th></tr></thead>
                <tbody>${items}</tbody>
              </table>
              <footer class="closing">
                <div class="total"><span>TOTAL</span><span>${peso(receipt.total)}</span></div>
                <div style="margin-top: 3mm">Thank you!</div>
              </footer>
            </main>
          </body>
        </html>`;
      await printHtmlDocument(`Receipt ${receipt.sale.receipt_number}`, html);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The receipt could not be printed.");
    }
  };

  const finishOfflineCheckout = async () => {
    if (!ownerId || !(await hasVerifiedAdmin(ownerId))) {
      throw new Error("Offline checkout is restricted to an Admin previously verified online.");
    }
    const savedInventory = await getOfflineInventory(ownerId);
    const savedProducts = await getOfflineProducts(ownerId);
    if (!savedInventory || !savedProducts) throw new Error("Cached POS data is missing. Reconnect and refresh POS.");
    const nextInventory = savedInventory.map(row => ({ ...row }));
    const nextProducts = savedProducts.map(row => ({ ...row }));
    const inventoryById = new Map(nextInventory.map(row => [row.id, row]));
    const productsById = new Map(nextProducts.map(row => [row.id, row]));
    const ingredientDemand = new Map<string, number>();
    const finishedDemand = new Map<string, number>();

    for (const item of cart) {
      const product = productsById.get(item.product_id);
      if (!product) throw new Error(`Product ${item.name} is no longer in the cached catalog.`);
      if (product.inventory_type !== "recipe_based") {
        finishedDemand.set(item.product_id, (finishedDemand.get(item.product_id) ?? 0) + item.quantity);
        continue;
      }
      const variant = (product.product_variants ?? []).find((entry: any) => entry.id === item.variant_id);
      const recipes = item.variant_id ? variant?.recipes : product.recipes;
      if (!Array.isArray(recipes) || recipes.length === 0) {
        throw new Error(`${item.name} has no cached recipe; offline checkout is unavailable.`);
      }
      for (const recipe of recipes) {
        const itemId = recipe.item_id ?? recipe.ingredient_id;
        const amount = Number(recipe.quantity_required ?? recipe.quantity) * item.quantity;
        if (!itemId || !Number.isFinite(amount) || amount <= 0 || !inventoryById.has(itemId)) {
          throw new Error(`${item.name} has incomplete cached recipe data.`);
        }
        ingredientDemand.set(itemId, (ingredientDemand.get(itemId) ?? 0) + amount);
      }
    }
    for (const [productId, amount] of finishedDemand) {
      const product = productsById.get(productId);
      if (Number(product.stock_quantity ?? 0) < amount) throw new Error(`Insufficient cached stock for ${product.name}.`);
      product.stock_quantity = Number(product.stock_quantity ?? 0) - amount;
      product.available_stock = product.stock_quantity;
    }
    for (const [itemId, amount] of ingredientDemand) {
      const ingredient = inventoryById.get(itemId)!;
      if (Number(ingredient.current_stock ?? 0) < amount) {
        throw new Error(`Insufficient cached ingredient stock for ${ingredient.name}.`);
      }
      ingredient.current_stock = Number(ingredient.current_stock) - amount;
      ingredient.total_used = Number(ingredient.total_used ?? 0) + amount;
    }
    for (const product of nextProducts) {
      if (product.inventory_type !== "recipe_based") continue;
      const variants = product.product_variants ?? [];
      product.available_stock = variants.length
        ? Math.max(0, Math.min(...variants.flatMap((variant: any) => (variant.recipes ?? []).map((recipe: any) => {
            const stock = Number(inventoryById.get(recipe.item_id ?? recipe.ingredient_id)?.current_stock ?? 0);
            const required = Number(recipe.quantity_required ?? recipe.quantity);
            return required > 0 ? Math.floor(stock / required) : 0;
          }))))
        : Math.max(0, Math.min(...(product.recipes ?? []).map((recipe: any) => {
            const stock = Number(inventoryById.get(recipe.item_id)?.current_stock ?? 0);
            return Math.floor(stock / Number(recipe.quantity_required));
          })));
    }

    const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const id = crypto.randomUUID();
    const receipt_number = `CZ-OFF-${id.replace(/-/g, "").toUpperCase()}`;
    const sale: OfflineSale = {
      id,
      ownerId,
      receipt_number,
      sale_date: new Date().toISOString(),
      subtotal,
      tax: 0,
      total_amount: subtotal,
      items: cart.map(({ product_id, variant_id, name, variant_name, price, quantity }) => {
        const product = productsById.get(product_id);
        const variant = product?.product_variants?.find((entry: any) => entry.id === variant_id);
        const sourceRecipe = variant_id ? variant?.recipes : product?.recipes;
        const expectedRecipe = Array.isArray(sourceRecipe)
          ? sourceRecipe.map((recipe: any) => ({
              item_id: recipe.item_id ?? recipe.ingredient_id,
              quantity_required: Number(recipe.quantity_required ?? recipe.quantity),
            })).sort((a: any, b: any) => a.item_id.localeCompare(b.item_id))
          : [];
        return { product_id, variant_id, name, variant_name, price, quantity, expectedRecipe };
      }),
      syncStatus: "pending",
    };
    await commitOfflineSale(sale, nextProducts, nextInventory);
    setInventory(nextInventory);
    setCart([]);
    setReceipt({
      sale: { id, receipt_number, subtotal, tax: 0, total_amount: subtotal },
      items: cart.map(item => ({ ...item })),
      subtotal,
      tax: 0,
      total: subtotal,
      ts: new Date(sale.sale_date),
      offline: true,
    });
    qc.invalidateQueries({ queryKey: ["products"] });
    qc.invalidateQueries({ queryKey: ["sales"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    toast.success(`Sale saved offline · ${receipt_number} · Pending Sync`);
  };

  return (
    <div className="space-y-4">
      {!isOnline && !offlineEligible ? (
        <div className="rounded-md border border-destructive/50 bg-destructive/5 p-6 text-sm text-destructive">
          Offline POS is available only to an Admin who previously signed in online on this device.
        </div>
      ) : <>{!isOnline && <div className="rounded-md border border-amber-500/50 bg-amber-500/10 px-4 py-2 text-sm font-medium text-amber-800">Offline Admin POS · Sales are stored on this device and marked Pending Sync.</div>}
      <div className="flex items-end justify-between gap-2">
        <div>
          <h1 className="font-display text-3xl font-bold">Point of Sale</h1>
          
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
                <button key={p.id} onClick={() => addToCart(p)} disabled={p.inventory_type !== "recipe_based" && p.available_stock === 0}
                className="group rounded-xl border bg-card p-4 text-left transition hover:border-primary hover:shadow-md disabled:opacity-40">
                <ProductImage path={p.image_url} className="h-40 w-full rounded-md" />
                <div className="mt-3 font-medium">{p.name}</div>
                <div className="text-xs text-muted-foreground">{p.categories?.name}</div>
                <div className="mt-2 flex items-center justify-between">
                  <span className="font-semibold text-primary">{p.inventory_type === "recipe_based" && p.product_variants?.length ? "Choose size" : peso(p.price)}</span>
                  <Badge variant={p.inventory_type === "recipe_based" ? "secondary" : p.available_stock <= p.low_stock_threshold ? "destructive" : "secondary"}>{p.inventory_type === "recipe_based" ? "Ingredient" : p.available_stock}</Badge>
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
                      <div className="text-sm font-medium">{c.name}{c.variant_name ? ` (${c.variant_name})` : ""}</div>
                      <div className="text-xs text-muted-foreground">{peso(c.price)} each</div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => adjust(c, -1)}><Minus className="h-3 w-3" /></Button>
                      <span className="w-6 text-center text-sm">{c.quantity}</span>
                      <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => adjust(c, 1)}><Plus className="h-3 w-3" /></Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => remove(c)}><Trash2 className="h-3 w-3" /></Button>
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

      <Dialog open={!!variantProduct} onOpenChange={(open) => !open && setVariantProduct(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{variantProduct?.name} sizes</DialogTitle></DialogHeader>
          <div className="grid gap-2">
            {(variantProduct?.product_variants ?? []).map((variant: any) => <Button key={variant.id} variant="outline" className="justify-between" onClick={() => addToCart(variantProduct, variant)}><span>{variant.name}</span><span>{peso(variant.price)}</span></Button>)}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!receipt} onOpenChange={(o) => !o && setReceipt(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Receipt</DialogTitle></DialogHeader>
          {receipt && (
            <>
              <div className="bg-white p-4 text-black">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 text-left">
                    <div className="font-display text-xl font-bold">COFFEE ZONE</div>
                    <div className="text-xs">Start your day right</div>
                  </div>
                  <img
                    src="/coffee-zone-logo.png"
                    className="h-12 w-12 shrink-0 rounded-full object-contain"
                    alt="Coffee Zone logo"
                  />
                </div>
                <div className="my-3 border-y border-dashed py-2 text-center text-xs">
                  <div>{receipt.sale.receipt_number}</div>
                  <div>{new Date(receipt.ts).toLocaleString()}</div>
                  {receipt.offline && <div className="font-semibold text-amber-700">Pending Sync</div>}
                </div>
                <table className="w-full text-xs">
                  <tbody>
                    {receipt.items.map((i: CartItem) => (
                      <tr key={`${i.product_id}-${i.variant_id ?? "default"}`}>
                        <td>{i.quantity}× {i.name}{i.variant_name ? ` (${i.variant_name})` : ""}</td>
                        <td className="text-right">{peso(i.price * i.quantity)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="mt-3 space-y-0.5 border-t border-dashed pt-2 text-xs">
                  {/* <div className="flex justify-between"><span>Subtotal</span><span>{peso(receipt.subtotal)}</span></div> */}
                  <div className="flex justify-between font-bold"><span>TOTAL</span><span>{peso(receipt.total)}</span></div>
                </div>
                <div className="mt-3 text-center text-xs">Thank you! ☕</div>
              </div>
              <div className="no-print mt-3 flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setReceipt(null)}><X className="mr-1 h-4 w-4" /> Close</Button>
                <Button className="flex-1" onClick={() => void printReceipt()}><Printer className="mr-1 h-4 w-4" /> Print</Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      </>}
    </div>
  );
}
