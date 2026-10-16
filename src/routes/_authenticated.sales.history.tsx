import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listSales } from "@/lib/api/coffee.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { DataTablePagination } from "@/components/data-table-pagination";
import { usePagination } from "@/hooks/use-pagination";
import { printTable } from "@/lib/print";
import { Printer } from "lucide-react";
import { useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { asHistorySale, cacheOnlineSales, getCachedOnlineSales, getOfflineSales, hasVerifiedAdmin, retryOfflineSale } from "@/lib/offline";

export const Route = createFileRoute("/_authenticated/sales/history")({
  head: () => ({ meta: [{ title: "Sales History — Coffee Zone" }] }),
  component: History,
});

const peso = (n: number) => "₱" + Number(n).toLocaleString("en-PH", { minimumFractionDigits: 2 });

function History() {
  const fn = useServerFn(listSales);
  const { data = [], isLoading } = useQuery({
    queryKey: ["sales"],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      try {
        const onlineSales = await fn();
        if (!session || !(await hasVerifiedAdmin(session.user.id))) return onlineSales;
        await cacheOnlineSales(session.user.id, onlineSales);
        const local = await getOfflineSales(session.user.id);
        const localSales = local.map(asHistorySale).filter(sale => sale.offline_status !== "Synced");
        return [...localSales, ...onlineSales];
      } catch (error) {
        if (navigator.onLine || !session || !(await hasVerifiedAdmin(session.user.id))) throw error;
        const cachedSales = (await getCachedOnlineSales(session.user.id)) ?? [];
        const local = (await getOfflineSales(session.user.id)).map(asHistorySale);
        const receipts = new Set(local.map(sale => sale.receipt_number));
        return [...local, ...cachedSales.filter((sale: any) => !receipts.has(sale.receipt_number))];
      }
    },
  });
  const [q, setQ] = useState("");
  const safeSales = Array.isArray(data) ? data.filter(Boolean) : [];
  const filtered = useMemo(
    () => safeSales.filter(s => typeof s?.receipt_number === "string" && s.receipt_number.toLowerCase().includes(q.toLowerCase())),
    [safeSales, q],
  );
  const { paginatedItems, ...pagination } = usePagination(filtered);

  const handlePrint = () => {
    printTable(
      "Sales History",
      ["Receipt", "Date", "Processed by", "Items", "Total"],
      filtered.map((s: any) => [
        `${s.receipt_number}${s.reservation?.reservation_number ? ` · Reservation ${s.reservation.reservation_number}` : ""}`,
        new Date(s.sale_date).toLocaleString(),
        s.operator_name || "Unknown staff",
        (s.sale_items ?? [])
          .map(
            (i: any) =>
              `${i.quantity}× ${i.products?.name}${i.variant_name ? ` (${i.variant_name})` : ""}`,
          )
          .join(", "),
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
                    <TableCell className="space-y-1 font-mono text-xs">
                      <div>{s.receipt_number}</div>
                      {s.reservation?.reservation_number && (
                        <Badge variant="outline" className="font-sans font-normal">
                          Reservation {s.reservation.reservation_number}
                        </Badge>
                      )}
                      {s.offline_status && s.offline_status !== "Synced" && (
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary" className="font-sans font-normal">{s.offline_status}</Badge>
                          {s.offline_status === "Sync issue" && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={async () => {
                                await retryOfflineSale(s.id);
                                window.dispatchEvent(new Event("coffee-zone-retry-offline-sync"));
                              }}
                            >
                              Retry Sync
                            </Button>
                          )}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <div>{new Date(s.sale_date).toLocaleString()}</div>
                      <div className="text-xs text-muted-foreground">
                        Staff: {s.operator_name || "Unknown staff"}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {(s.sale_items ?? [])
                        .map(
                          (i: any) =>
                            `${i.quantity}× ${i.products?.name}${i.variant_name ? ` (${i.variant_name})` : ""}`,
                        )
                        .join(", ")}
                    </TableCell>
                    <TableCell className="text-right font-semibold">
                      {peso(s.total_amount)}
                    </TableCell>
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
