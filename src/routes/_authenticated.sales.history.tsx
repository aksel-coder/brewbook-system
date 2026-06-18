import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listSales } from "@/lib/api/coffee.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DataTablePagination } from "@/components/data-table-pagination";
import { usePagination } from "@/hooks/use-pagination";
import { printTable } from "@/lib/print";
import { Printer } from "lucide-react";
import { useState, useMemo } from "react";

export const Route = createFileRoute("/_authenticated/sales/history")({
  head: () => ({ meta: [{ title: "Sales History — Coffee Zone" }] }),
  component: History,
});

const peso = (n: number) => "₱" + Number(n).toLocaleString("en-PH", { minimumFractionDigits: 2 });

function History() {
  const fn = useServerFn(listSales);
  const { data = [], isLoading } = useQuery({ queryKey: ["sales"], queryFn: () => fn() });
  const [q, setQ] = useState("");
  const filtered = useMemo(
    () => (data as any[]).filter(s => s.receipt_number.toLowerCase().includes(q.toLowerCase())),
    [data, q],
  );
  const { paginatedItems, ...pagination } = usePagination(filtered);

  const handlePrint = () => {
    printTable(
      "Sales History",
      ["Receipt", "Date", "Items", "Subtotal", "Total"],
      filtered.map((s: any) => [
        s.receipt_number,
        new Date(s.sale_date).toLocaleString(),
        (s.sale_items ?? []).map((i: any) => `${i.quantity}× ${i.products?.name}`).join(", "),
        peso(s.subtotal),
        peso(s.tax),
        peso(s.total_amount),
      ]),
    );
  };

  return (
    <div className="space-y-4">
      <h1 className="font-display text-3xl font-bold">Sales History</h1>
      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle className="font-display">All Transactions</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Input placeholder="Search receipt #" value={q} onChange={e => setQ(e.target.value)} className="max-w-xs" />
            <Button variant="outline" size="sm" onClick={handlePrint} disabled={filtered.length === 0}>
              <Printer className="mr-1 h-4 w-4" /> Print
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Receipt</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Items</TableHead>
                {/* <TableHead className="text-right">Subtotal</TableHead> */}
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? <TableRow><TableCell colSpan={6} className="text-center">Loading...</TableCell></TableRow> :
                paginatedItems.length === 0 ? <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No sales</TableCell></TableRow> :
                paginatedItems.map((s: any) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-mono text-xs">{s.receipt_number}</TableCell>
                    <TableCell>{new Date(s.sale_date).toLocaleString()}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {(s.sale_items ?? []).map((i: any) => `${i.quantity}× ${i.products?.name}`).join(", ")}
                    </TableCell>
                    {/* <TableCell className="text-right">{peso(s.subtotal)}</TableCell> */}
                    <TableCell className="text-right font-semibold">{peso(s.subtotal)}</TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
          <DataTablePagination {...pagination} onPageChange={pagination.setPage} />
        </CardContent>
      </Card>
    </div>
  );
}
