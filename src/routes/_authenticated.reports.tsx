import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listSales, listProducts } from "@/lib/api/coffee.functions";
import { loadProducts, loadSales } from "@/lib/offline/data-access";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download, FileText } from "lucide-react";
import { useMemo } from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => ({ meta: [{ title: "Reports — Coffee Zone" }] }),
  component: Reports,
});

const peso = (n: number) => "₱" + Number(n).toLocaleString("en-PH", { minimumFractionDigits: 2 });

function downloadCSV(filename: string, rows: (string | number)[][]) {
  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = filename; a.click();
}

function downloadPDF(title: string, head: string[], body: (string | number)[][]) {
  const doc = new jsPDF();
  doc.setFontSize(16); doc.text("Coffee Zone — " + title, 14, 18);
  doc.setFontSize(10); doc.text(new Date().toLocaleString(), 14, 25);
  autoTable(doc, { head: [head], body: body as any, startY: 30, theme: "striped", headStyles: { fillColor: [111, 78, 55] } });
  doc.save(`${title.replace(/\s+/g, "_")}.pdf`);
}

function Reports() {
  const salesFn = useServerFn(listSales);
  const prodFn = useServerFn(listProducts);
  const { data: sales = [] } = useQuery({ queryKey: ["sales"], queryFn: () => loadSales(() => salesFn()) });
  const { data: products = [] } = useQuery({ queryKey: ["products"], queryFn: () => loadProducts(() => prodFn()) });

  const now = new Date();
  const buckets = useMemo(() => {
    const day = new Date(now); day.setHours(0, 0, 0, 0);
    const week = new Date(now); week.setDate(week.getDate() - 7);
    const month = new Date(now); month.setMonth(month.getMonth() - 1);
    const inRange = (d: Date, since: Date) => d >= since;
    const filter = (since: Date) => (sales as any[]).filter(s => inRange(new Date(s.sale_date), since));
    return { daily: filter(day), weekly: filter(week), monthly: filter(month) };
  }, [sales]);

  const bestSellers = useMemo(() => {
    const map = new Map<string, { name: string; qty: number; revenue: number }>();
    for (const s of sales as any[]) for (const i of s.sale_items ?? []) {
      const name = i.products?.name ?? "Unknown";
      const cur = map.get(name) ?? { name, qty: 0, revenue: 0 };
      cur.qty += i.quantity; cur.revenue += i.quantity * Number(i.unit_price);
      map.set(name, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.qty - a.qty);
  }, [sales]);

  const lowStock = (products as any[]).filter(p => p.stock_quantity <= p.low_stock_threshold);

  const exportSales = (label: string, data: any[]) => {
    const rows = data.map(s => [s.receipt_number, new Date(s.sale_date).toLocaleString(), Number(s.subtotal).toFixed(2), Number(s.tax).toFixed(2), Number(s.total_amount).toFixed(2)]);
    return { csv: () => downloadCSV(`${label}.csv`, [["Receipt", "Date", "Subtotal", "Tax", "Total"], ...rows]),
             pdf: () => downloadPDF(label, ["Receipt", "Date", "Subtotal", "Tax", "Total"], rows) };
  };

  const renderSales = (label: string, data: any[]) => {
    const total = data.reduce((s, x) => s + Number(x.total_amount), 0);
    const exp = exportSales(label, data);
    return (
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle className="font-display">{label}</CardTitle>
            <p className="text-sm text-muted-foreground">{data.length} transactions · Total {peso(total)}</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={exp.csv}><Download className="mr-1 h-4 w-4" /> CSV</Button>
            <Button variant="outline" size="sm" onClick={exp.pdf}><FileText className="mr-1 h-4 w-4" /> PDF</Button>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Receipt</TableHead><TableHead>Date</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader>
            <TableBody>
              {data.slice(0, 30).map(s => (
                <TableRow key={s.id}><TableCell className="font-mono text-xs">{s.receipt_number}</TableCell>
                  <TableCell>{new Date(s.sale_date).toLocaleString()}</TableCell>
                  <TableCell className="text-right font-semibold">{peso(s.total_amount)}</TableCell></TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-4">
      <h1 className="font-display text-3xl font-bold">Reports</h1>
      <Tabs defaultValue="daily">
        <TabsList>
          <TabsTrigger value="daily">Daily</TabsTrigger>
          <TabsTrigger value="weekly">Weekly</TabsTrigger>
          <TabsTrigger value="monthly">Monthly</TabsTrigger>
          <TabsTrigger value="best">Best Sellers</TabsTrigger>
          <TabsTrigger value="low">Low Stock</TabsTrigger>
          <TabsTrigger value="inv">Inventory</TabsTrigger>
        </TabsList>
        <TabsContent value="daily">{renderSales("Daily Sales", buckets.daily)}</TabsContent>
        <TabsContent value="weekly">{renderSales("Weekly Sales", buckets.weekly)}</TabsContent>
        <TabsContent value="monthly">{renderSales("Monthly Sales", buckets.monthly)}</TabsContent>
        <TabsContent value="best">
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle className="font-display">Best Selling Products</CardTitle>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => downloadCSV("best_sellers.csv", [["Product", "Quantity", "Revenue"], ...bestSellers.map(b => [b.name, b.qty, b.revenue.toFixed(2)])])}><Download className="mr-1 h-4 w-4" /> CSV</Button>
                <Button variant="outline" size="sm" onClick={() => downloadPDF("Best Sellers", ["Product", "Quantity", "Revenue"], bestSellers.map(b => [b.name, b.qty, peso(b.revenue)]))}><FileText className="mr-1 h-4 w-4" /> PDF</Button>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow><TableHead>Product</TableHead><TableHead className="text-right">Sold</TableHead><TableHead className="text-right">Revenue</TableHead></TableRow></TableHeader>
                <TableBody>{bestSellers.map(b => <TableRow key={b.name}><TableCell>{b.name}</TableCell><TableCell className="text-right">{b.qty}</TableCell><TableCell className="text-right">{peso(b.revenue)}</TableCell></TableRow>)}</TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="low">
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle className="font-display">Low Stock Report</CardTitle>
              <Button variant="outline" size="sm" onClick={() => downloadCSV("low_stock.csv", [["Product", "Stock", "Threshold"], ...lowStock.map(p => [p.name, p.stock_quantity, p.low_stock_threshold])])}><Download className="mr-1 h-4 w-4" /> CSV</Button>
            </CardHeader>
            <CardContent>
              {lowStock.length === 0 ? <p className="text-muted-foreground text-sm">All items healthy.</p> :
                <Table>
                  <TableHeader><TableRow><TableHead>Product</TableHead><TableHead className="text-right">Stock</TableHead><TableHead className="text-right">Threshold</TableHead></TableRow></TableHeader>
                  <TableBody>{lowStock.map(p => <TableRow key={p.id}><TableCell>{p.name}</TableCell><TableCell className="text-right">{p.stock_quantity}</TableCell><TableCell className="text-right">{p.low_stock_threshold}</TableCell></TableRow>)}</TableBody>
                </Table>}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="inv">
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle className="font-display">Inventory Snapshot</CardTitle>
              <Button variant="outline" size="sm" onClick={() => downloadPDF("Inventory", ["Product", "Stock", "Price", "Value"], (products as any[]).map(p => [p.name, p.stock_quantity, peso(p.price), peso(p.stock_quantity * Number(p.price))]))}><FileText className="mr-1 h-4 w-4" /> PDF</Button>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow><TableHead>Product</TableHead><TableHead className="text-right">Stock</TableHead><TableHead className="text-right">Price</TableHead><TableHead className="text-right">Stock Value</TableHead></TableRow></TableHeader>
                <TableBody>{(products as any[]).map(p => <TableRow key={p.id}><TableCell>{p.name}</TableCell><TableCell className="text-right">{p.stock_quantity}</TableCell><TableCell className="text-right">{peso(p.price)}</TableCell><TableCell className="text-right">{peso(p.stock_quantity * Number(p.price))}</TableCell></TableRow>)}</TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
