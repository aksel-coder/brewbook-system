import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getDashboardStats } from "@/lib/api/coffee.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Coins, Package, Boxes, AlertTriangle, TrendingUp } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, CartesianGrid } from "recharts";
import { useState } from "react";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — Coffee Zone" }] }),
  component: Dashboard,
});

const peso = (n: number) => "₱" + Number(n).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type DatePreset = "week" | "today" | "yesterday" | "7days" | "30days" | "custom";

function dayStart(date: Date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function getDateRange(preset: Exclude<DatePreset, "custom">, now = new Date()) {
  const end = dayStart(now);
  const start = new Date(end);
  if (preset === "week") {
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);
  } else if (preset === "today") {
    end.setHours(23, 59, 59, 999);
  } else if (preset === "yesterday") {
    start.setDate(start.getDate() - 1);
    end.setTime(start.getTime());
    end.setHours(23, 59, 59, 999);
  } else {
    start.setDate(start.getDate() - (preset === "7days" ? 6 : 29));
    end.setHours(23, 59, 59, 999);
  }
  return { startDate: start.toISOString(), endDate: end.toISOString() };
}

function inputDate(date: Date) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

function formatDateRange(startDate: string, endDate: string) {
  const format = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
  return `${format.format(new Date(startDate))} – ${format.format(new Date(endDate))}`;
}

function Dashboard() {
  const fn = useServerFn(getDashboardStats);
  const [preset, setPreset] = useState<DatePreset>("week");
  const initialRange = getDateRange("week");
  const [customStart, setCustomStart] = useState(inputDate(new Date(initialRange.startDate)));
  const [customEnd, setCustomEnd] = useState(inputDate(new Date(initialRange.endDate)));
  const [range, setRange] = useState(initialRange);
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["dashboard", range.startDate, range.endDate],
    queryFn: () => fn({ data: range }),
    retry: (count, err) => {
      if (count < 2 && err instanceof Error && err.message.toLowerCase().includes("unauthorized")) return true;
      return count < 1;
    },
  });

  if (isLoading) return <div className="grid gap-4 md:grid-cols-4">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28" />)}</div>;

  if (isError || !data) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground space-y-3">
        <p>Could not load dashboard data. Check your connection and try again.</p>
        {error instanceof Error && error.message && (
          <p className="text-xs text-destructive/80">{error.message}</p>
        )}
        <button type="button" className="text-primary underline" onClick={() => refetch()}>Retry</button>
      </div>
    );
  }

  const applyRange = () => {
    if (preset === "custom") {
      if (!customStart || !customEnd || customStart > customEnd) return;
      const start = new Date(`${customStart}T00:00:00`);
      const end = new Date(`${customEnd}T23:59:59.999`);
      setRange({ startDate: start.toISOString(), endDate: end.toISOString() });
      return;
    }
    setRange(getDateRange(preset));
  };

  const kpis = [
    { label: "Total Sales", value: peso(data.totalSales), icon: Coins, hint: formatDateRange(range.startDate, range.endDate) },
    { label: "Total Products", value: data.totalProducts, icon: Package, hint: `${data.totalStock} units in stock` },
    { label: "Inventory On Hand", value: data.totalStock, icon: Boxes, hint: "units across all products" },
    { label: "Low Stock Alerts", value: data.lowStockCount, icon: AlertTriangle, hint: "items at/below threshold" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <h1 className="font-display text-3xl font-bold">Dashboard</h1>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <label htmlFor="dashboard-date-range" className="text-xs text-muted-foreground">Date range</label>
            <select id="dashboard-date-range" value={preset} onChange={e => setPreset(e.target.value as DatePreset)} className="h-9 rounded-md border border-input bg-background px-3 text-sm">
              <option value="week">This Week</option>
              <option value="today">Today</option>
              <option value="yesterday">Yesterday</option>
              <option value="7days">Last 7 Days</option>
              <option value="30days">Last 30 Days</option>
              <option value="custom">Custom Date</option>
            </select>
          </div>
          {preset === "custom" && <>
            <Input aria-label="Start Date" type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} className="w-36" />
            <Input aria-label="End Date" type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} className="w-36" />
          </>}
          <Button type="button" onClick={applyRange}>Apply</Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {kpis.map((k) => (
          <Card key={k.label} className="overflow-hidden">
            <CardContent className="flex items-start justify-between p-5">
              <div>
                <div className="text-sm text-muted-foreground">{k.label}</div>
                <div className="mt-1 font-display text-3xl font-bold">{k.value}</div>
                <div className="mt-1 text-xs text-muted-foreground">{k.hint}</div>
              </div>
              <div className="rounded-full bg-primary/10 p-3 text-primary"><k.icon className="h-5 w-5" /></div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="font-display flex items-center gap-2"><TrendingUp className="h-5 w-5" /> Sales ({formatDateRange(range.startDate, range.endDate)})</CardTitle></CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.salesChart}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis dataKey="date" stroke="var(--muted-foreground)" fontSize={12} />
                <YAxis stroke="var(--muted-foreground)" fontSize={12} />
                <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8 }} formatter={(v: any) => peso(v)} />
                <Line type="monotone" dataKey="total" stroke="var(--primary)" strokeWidth={3} dot={{ fill: "var(--primary)" }} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="font-display">Best Sellers</CardTitle></CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.best} layout="vertical" margin={{ left: 20 }}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis type="number" stroke="var(--muted-foreground)" fontSize={12} />
                <YAxis type="category" dataKey="name" stroke="var(--muted-foreground)" fontSize={11} width={90} />
                <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8 }} />
                <Bar dataKey="qty" fill="var(--success)" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="font-display">Recent Transactions</CardTitle></CardHeader>
          <CardContent>
            {data.recent.length === 0 ? <p className="text-sm text-muted-foreground">No transactions yet.</p> :
              <ul className="divide-y">
                {data.recent.map((s: any) => (
                  <li key={s.id} className="flex items-center justify-between py-2">
                    <div>
                      <div className="font-medium">{s.receipt_number}</div>
                      <div className="text-xs text-muted-foreground">{new Date(s.sale_date).toLocaleString()}</div>
                    </div>
                    <div className="font-semibold text-primary">{peso(s.total_amount)}</div>
                  </li>
                ))}
              </ul>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="font-display flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-warning" /> Low Stock</CardTitle></CardHeader>
          <CardContent>
            {data.lowStockItems.length === 0 ? <p className="text-sm text-muted-foreground">All items healthy.</p> :
              <ul className="divide-y">
                {data.lowStockItems.map((p: any) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                    <span className="truncate">{p.name}</span>
                    <Badge variant="destructive" className="shrink-0">
                      {p.stock_quantity === 0 ? "SOLD OUT" : `${p.stock_quantity} left`}
                    </Badge>
                  </li>
                ))}
              </ul>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
