import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listSales } from "@/lib/api/coffee.functions";
import { loadSales } from "@/lib/offline/data-access";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { useState, useMemo } from "react";

export const Route = createFileRoute("/_authenticated/sales/history")({
  head: () => ({ meta: [{ title: "Sales History — Coffee Zone" }] }),
  component: History,
});

const peso = (n: number) => "₱" + Number(n).toLocaleString("en-PH", { minimumFractionDigits: 2 });

function History() {
  const fn = useServerFn(listSales);
  const { data = [], isLoading } = useQuery({ queryKey: ["sales"], queryFn: () => loadSales(() => fn()) });
  const [q, setQ] = useState("");
  const filtered = useMemo(() => (data as any[]).filter(s => s.receipt_number.toLowerCase().includes(q.toLowerCase())), [data, q]);

  return (
    <div className="space-y-4">
      <h1 className="font-display text-3xl font-bold">Sales History</h1>
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="font-display">All Transactions</CardTitle>
          <Input placeholder="Search receipt #" value={q} onChange={e => setQ(e.target.value)} className="max-w-xs" />
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Receipt</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Items</TableHead>
                <TableHead className="text-right">Subtotal</TableHead>
                <TableHead className="text-right">Tax</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? <TableRow><TableCell colSpan={6} className="text-center">Loading...</TableCell></TableRow> :
                filtered.length === 0 ? <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No sales</TableCell></TableRow> :
                filtered.map((s: any) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-mono text-xs">{s.receipt_number}</TableCell>
                    <TableCell>{new Date(s.sale_date).toLocaleString()}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {(s.sale_items ?? []).map((i: any) => `${i.quantity}× ${i.products?.name}`).join(", ")}
                    </TableCell>
                    <TableCell className="text-right">{peso(s.subtotal)}</TableCell>
                    <TableCell className="text-right">{peso(s.tax)}</TableCell>
                    <TableCell className="text-right font-semibold">{peso(s.total_amount)}</TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
