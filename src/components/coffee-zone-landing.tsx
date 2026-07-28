import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Coffee,
  ShoppingCart,
  Package,
  BarChart3,
  Users,
  ShieldCheck,
  ArrowRight,
  CheckCircle2,
} from "lucide-react";
import logo from "@/assets/coffee-zone-logo.jpg.asset.json";
import { getDashboardStats } from "@/lib/api/coffee.functions";

const features = [
  {
    icon: ShoppingCart,
    title: "Fast Point of Sale",
    desc: "Take orders in seconds with a streamlined register built for busy mornings.",
  },
  {
    icon: Package,
    title: "Live Inventory",
    desc: "Stock updates automatically with every sale. Get alerts before you run out.",
  },
  {
    icon: Coffee,
    title: "Product Management",
    desc: "Organize your menu, upload product photos and adjust pricing in one place.",
  },
  {
    icon: BarChart3,
    title: "Reports",
    desc: "View sales and inventory reports.",
  },
  {
    icon: Users,
    title: "User Management",
    desc: "Manage admin and cashier accounts.",
  },
  {
    icon: ShieldCheck,
    title: "Secure Login",
    desc: "Role-based access with secure authentication.",
  },
];

const formatPeso = (n: number) =>
  "₱" + Number(n).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function CoffeeZoneLandingPage() {
  const fn = useServerFn(getDashboardStats);
  const { data } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => fn(),
    retry: (count, err) => {
      if (count < 2 && err instanceof Error && err.message.toLowerCase().includes("unauthorized")) {
        return true;
      }
      return count < 1;
    },
  });

  const logoSrc = logo?.url ?? "/coffeLogo.jpg";

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <Link to="/" className="flex items-center gap-2">
            <img src={logoSrc} alt="Coffee Zone" className="h-9 w-9 rounded-full" />
            <span className="font-display text-lg font-bold">Coffee Zone</span>
          </Link>
          <nav className="hidden items-center gap-8 text-sm text-muted-foreground md:flex">
            <a href="#features" className="hover:text-foreground">
              Features
            </a>
            <a href="#workflow" className="hover:text-foreground">
              Workflow
            </a>
          </nav>
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link to="/login" search={{}}>
                Sign in
              </Link>
            </Button>
            <Button asChild size="sm">
              <Link to="/login" search={{}}>
                Get started
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-linear-to-br from-primary/10 via-background to-secondary/40" />
        <div className="relative mx-auto max-w-6xl px-4 py-20 md:py-28">
          <div className="grid items-center gap-12 md:grid-cols-2">
            <div>
              <h1 className="mt-5 font-display text-4xl font-bold leading-tight md:text-6xl">
                Run your coffee shop with{" "}
                <span className="bg-linear-to-r from-primary to-primary/60 bg-clip-text text-transparent">
                  clarity & speed
                </span>
              </h1>
              <p className="mt-5 max-w-lg text-base text-muted-foreground md:text-lg">
                Manage sales, inventory, products, and reports in one system.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Button asChild size="lg">
                  <Link to="/login" search={{}}>
                    Open the dashboard <ArrowRight className="ml-1 h-4 w-4" />
                  </Link>
                </Button>
                <Button asChild size="lg" variant="outline">
                  <Link to="/login" search={{}}>
                    Sign In
                  </Link>
                </Button>
              </div>
              <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
                {[
                  "Real-time stock",
                  "Role-based access",
                  "Insightful reports",
                ].map((t) => (
                  <span key={t} className="inline-flex items-center gap-1.5">
                    <CheckCircle2 className="h-4 w-4 text-primary" /> {t}
                  </span>
                ))}
              </div>
            </div>
            <div className="relative">
              <div className="absolute -inset-6 rounded-3xl bg-linear-to-tr from-primary/20 to-transparent blur-2xl" />
              <div className="relative rounded-3xl border border-border/60 bg-card p-6 shadow-2xl">
                <div className="flex items-center gap-3 border-b border-border/60 pb-4">
                  <img src={logoSrc} alt="" className="h-12 w-12 rounded-full" />
                  <div>
                    <p className="font-semibold">Today's Sales</p>
                  </div>
                </div>
                <div className="mt-5 grid grid-cols-2 gap-3">
                  {[
                    { label: "Revenue", value: formatPeso(data?.totalSales || 0) },
                    { label: "Orders", value: data?.orderCount?.toString() ?? "0" },
                    { label: "Top item", value: data?.topItem?.name ?? "No sales yet" },
                    { label: "Stock alerts", value: (data?.lowStockCount ?? 0).toString() },
                  ].map((s) => (
                    <div key={s.label} className="rounded-xl bg-muted/50 p-4">
                      <p className="text-xs text-muted-foreground">{s.label}</p>
                      <p className="mt-1 text-xl font-bold">{s.value}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-5 space-y-2">
                  {(data?.best ?? []).slice(0, 3).map((item: any) => (
                    <div
                      key={item.name}
                      className="flex items-center justify-between rounded-lg border border-border/40 px-3 py-2 text-sm"
                    >
                      <span>{item.name}</span>
                      <span className="font-medium">{formatPeso(item.price ?? 0)}</span>
                    </div>
                  ))}
                  {(!data?.best || data.best.length === 0) && (
                    <div className="rounded-lg border border-dashed border-border/40 px-3 py-2 text-sm text-muted-foreground">
                      No sales data available yet.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="features" className="mx-auto max-w-6xl px-4 py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="font-display text-3xl font-bold md:text-4xl">
            Everything you need to run the shop
          </h2>
        </div>
        <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <Card
              key={f.title}
              className="group border-border/60 transition-all hover:-translate-y-1 hover:shadow-lg"
            >
              <CardContent className="p-6">
                <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                  <f.icon className="h-5 w-5" />
                </div>
                <h3 className="mt-4 text-lg font-semibold">{f.title}</h3>
                <p className="mt-1.5 text-sm text-muted-foreground">{f.desc}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section id="workflow" className="bg-secondary/40 py-20">
        <div className="mx-auto max-w-6xl px-4">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="font-display text-3xl font-bold md:text-4xl">How the System Works</h2>
          </div>
          <ol className="mx-auto mt-12 grid max-w-4xl gap-4 md:grid-cols-2">
            {[
              ["Login", "Secure staff sign-in and access control."],
              ["Dashboard", "Review daily sales and inventory health."],
              ["Sales", "Process orders quickly at the register."],
              ["Inventory", "Track stock levels and low-stock alerts."],
              ["Products", "Manage menu items and pricing."],
              ["Reports & Users", "Review reports and manage user access."],
            ].map(([title, desc], i) => (
              <li
                key={title}
                className="flex gap-4 rounded-xl border border-border/60 bg-background p-5"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground">
                  {i + 1}
                </span>
                <div>
                  <p className="font-semibold">{title}</p>
                  <p className="text-sm text-muted-foreground">{desc}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="about" className="mx-auto max-w-6xl px-4 py-20">
        <div className="overflow-hidden rounded-3xl border border-border/60 bg-linear-to-br from-primary to-primary/70 p-10 text-primary-foreground md:p-14">
          <div className="grid items-center gap-8 md:grid-cols-[1fr_auto]">
            <div>
              <h2 className="font-display text-3xl font-bold md:text-4xl">
                Ready to Get Started?
              </h2>
              <p className="mt-3 max-w-xl text-primary-foreground/90">
                Access your Coffee Zone account.
              </p>
            </div>
            <Button asChild size="lg" variant="secondary" className="w-fit">
              <Link to="/login" search={{}}>
                Sign in <ArrowRight className="ml-1 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      <footer className="border-t border-border/60 py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 text-sm text-muted-foreground md:flex-row">
          <div className="flex items-center gap-2">
            <img src={logoSrc} alt="" className="h-6 w-6 rounded-full" />
            <span>© {new Date().getFullYear()} Coffee Zone. All rights reserved.</span>
          </div>
          <div className="flex gap-5">
            <a href="#features" className="hover:text-foreground">
              Features
            </a>
            <a href="#workflow" className="hover:text-foreground">
              Workflow
            </a>
            <Link to="/login" search={{}} className="hover:text-foreground">
              Sign in
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
