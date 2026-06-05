import { createFileRoute, Link } from "@tanstack/react-router";
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

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Coffee Zone — Sales & Inventory Management" },
      {
        name: "description",
        content:
          "All-in-one sales and inventory platform for modern coffee shops. Track stock, run the register, manage staff and grow with insights.",
      },
      { property: "og:title", content: "Coffee Zone — Sales & Inventory Management" },
      {
        property: "og:description",
        content:
          "Run your coffee shop with confidence: real-time inventory, fast POS, reports and team management.",
      },
    ],
    links: [{ rel: "canonical", href: "/" }],
  }),
  component: LandingPage,
});

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
    title: "Smart Reports",
    desc: "Daily, weekly and monthly insights into sales, top products and revenue.",
  },
  {
    icon: Users,
    title: "Team Roles",
    desc: "Admin, manager and cashier roles with proper access for each staff member.",
  },
  {
    icon: ShieldCheck,
    title: "Secure by Default",
    desc: "Cloud-backed data with role-based access and encrypted authentication.",
  },
];

function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <Link to="/" className="flex items-center gap-2">
            <img src={logo.url} alt="Coffee Zone" className="h-9 w-9 rounded-full" />
            <span className="font-display text-lg font-bold">Coffee Zone</span>
          </Link>
          <nav className="hidden items-center gap-8 text-sm text-muted-foreground md:flex">
            <a href="#features" className="hover:text-foreground">Features</a>
            <a href="#workflow" className="hover:text-foreground">Workflow</a>
            <a href="#about" className="hover:text-foreground">About</a>
          </nav>
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link to="/login">Sign in</Link>
            </Button>
            <Button asChild size="sm">
              <Link to="/login">Get started</Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-background to-secondary/40" />
        <div className="relative mx-auto max-w-6xl px-4 py-20 md:py-28">
          <div className="grid items-center gap-12 md:grid-cols-2">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background/60 px-3 py-1 text-xs font-medium text-muted-foreground">
                <Coffee className="h-3.5 w-3.5" /> Built for coffee shops
              </span>
              <h1 className="mt-5 font-display text-4xl font-bold leading-tight md:text-6xl">
                Run your coffee shop with{" "}
                <span className="bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
                  clarity & speed
                </span>
              </h1>
              <p className="mt-5 max-w-lg text-base text-muted-foreground md:text-lg">
                Coffee Zone unifies sales, inventory, products and reports into one beautiful
                workspace — so you can focus on the brew, not the spreadsheets.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Button asChild size="lg">
                  <Link to="/login">
                    Open the dashboard <ArrowRight className="ml-1 h-4 w-4" />
                  </Link>
                </Button>
                <Button asChild size="lg" variant="outline">
                  <a href="#features">Explore features</a>
                </Button>
              </div>
              <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
                {["Real-time stock", "Role-based access", "Insightful reports"].map((t) => (
                  <span key={t} className="inline-flex items-center gap-1.5">
                    <CheckCircle2 className="h-4 w-4 text-primary" /> {t}
                  </span>
                ))}
              </div>
            </div>
            <div className="relative">
              <div className="absolute -inset-6 rounded-3xl bg-gradient-to-tr from-primary/20 to-transparent blur-2xl" />
              <div className="relative rounded-3xl border border-border/60 bg-card p-6 shadow-2xl">
                <div className="flex items-center gap-3 border-b border-border/60 pb-4">
                  <img src={logo.url} alt="" className="h-12 w-12 rounded-full" />
                  <div>
                    <p className="font-semibold">Today's Sales</p>
                    <p className="text-xs text-muted-foreground">Live overview</p>
                  </div>
                </div>
                <div className="mt-5 grid grid-cols-2 gap-3">
                  {[
                    { label: "Revenue", value: "$1,284" },
                    { label: "Orders", value: "96" },
                    { label: "Top item", value: "Latte" },
                    { label: "Stock alerts", value: "2" },
                  ].map((s) => (
                    <div key={s.label} className="rounded-xl bg-muted/50 p-4">
                      <p className="text-xs text-muted-foreground">{s.label}</p>
                      <p className="mt-1 text-xl font-bold">{s.value}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-5 space-y-2">
                  {[
                    ["Espresso", "$3.50"],
                    ["Cappuccino", "$4.20"],
                    ["Croissant", "$2.80"],
                  ].map(([n, p]) => (
                    <div
                      key={n}
                      className="flex items-center justify-between rounded-lg border border-border/40 px-3 py-2 text-sm"
                    >
                      <span>{n}</span>
                      <span className="font-medium">{p}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="mx-auto max-w-6xl px-4 py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="font-display text-3xl font-bold md:text-4xl">
            Everything you need to run the shop
          </h2>
          <p className="mt-3 text-muted-foreground">
            A modern system designed around the daily rhythm of a coffee business.
          </p>
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

      {/* Workflow */}
      <section id="workflow" className="bg-secondary/40 py-20">
        <div className="mx-auto max-w-6xl px-4">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="font-display text-3xl font-bold md:text-4xl">A workflow that flows</h2>
            <p className="mt-3 text-muted-foreground">
              From login to insights — every step connected.
            </p>
          </div>
          <ol className="mx-auto mt-12 grid max-w-4xl gap-4 md:grid-cols-2">
            {[
              ["Login", "Secure credential validation for staff."],
              ["Dashboard", "Snapshot of today's performance."],
              ["Sales", "Ring up orders quickly at the counter."],
              ["Inventory", "Auto-updated stock with low-stock alerts."],
              ["Products", "Manage menu items, photos and pricing."],
              ["Reports & Users", "Insights and team role management."],
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

      {/* CTA */}
      <section id="about" className="mx-auto max-w-6xl px-4 py-20">
        <div className="overflow-hidden rounded-3xl border border-border/60 bg-gradient-to-br from-primary to-primary/70 p-10 text-primary-foreground md:p-14">
          <div className="grid items-center gap-8 md:grid-cols-[1fr_auto]">
            <div>
              <h2 className="font-display text-3xl font-bold md:text-4xl">
                Ready to brew better business?
              </h2>
              <p className="mt-3 max-w-xl text-primary-foreground/90">
                Sign in to your Coffee Zone workspace and start managing sales and inventory in
                minutes.
              </p>
            </div>
            <Button asChild size="lg" variant="secondary" className="w-fit">
              <Link to="/login">
                Sign in <ArrowRight className="ml-1 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/60 py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 text-sm text-muted-foreground md:flex-row">
          <div className="flex items-center gap-2">
            <img src={logo.url} alt="" className="h-6 w-6 rounded-full" />
            <span>© {new Date().getFullYear()} Coffee Zone. All rights reserved.</span>
          </div>
          <div className="flex gap-5">
            <a href="#features" className="hover:text-foreground">Features</a>
            <a href="#workflow" className="hover:text-foreground">Workflow</a>
            <Link to="/login" className="hover:text-foreground">Sign in</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
