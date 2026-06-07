import { createFileRoute, useNavigate, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import logo from "@/assets/coffee-zone-logo.jpg.asset.json";
import { isAppAuthenticated, tryOfflineLogin } from "@/lib/offline/auth-offline";
import { saveCredential } from "@/lib/offline/credentials";
import { bootstrapDataPull } from "@/lib/offline/bootstrap";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { useServerFn } from "@tanstack/react-start";
import {
  listCategories,
  listInventoryTxns,
  listProducts,
  listSales,
} from "@/lib/api/coffee.functions";
import { getMyRole, listUsers } from "@/lib/api/users.functions";

type LoginSearch = { redirect?: string };

const safeRedirect = (value: unknown) => {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value === "/login") {
    return "/dashboard";
  }
  return value;
};

export const Route = createFileRoute("/login")({
  validateSearch: (search): LoginSearch => {
    const redirectTo = typeof search.redirect === "string" ? search.redirect : undefined;
    return redirectTo ? { redirect: redirectTo } : {};
  },
  beforeLoad: async ({ search }) => {
    const { data } = await supabase.auth.getSession();
    if (data.session) throw redirect({ to: safeRedirect(search.redirect) as any, replace: true });

    if (typeof window !== "undefined" && isOfflineAuthActive()) {
      const session = await getSession();
      if (session) throw redirect({ to: safeRedirect(search.redirect) as any, replace: true });
    }
  },
  head: () => ({ meta: [{ title: "Sign in — Coffee Zone" }] }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const online = useOnlineStatus();
  const listProductsFn = useServerFn(listProducts);
  const listCategoriesFn = useServerFn(listCategories);
  const listSalesFn = useServerFn(listSales);
  const listInventoryFn = useServerFn(listInventoryTxns);
  const getMyRoleFn = useServerFn(getMyRole);
  const listUsersFn = useServerFn(listUsers);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(false);

  const signIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (online) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) return toast.error(error.message);
        await saveCredential({ email, password });
        toast.success("Welcome back!");
      } else {
        const ok = await tryOfflineLogin(email, password);
        if (!ok) {
          return toast.error("Invalid credentials or no cached account. Sign in online at least once first.");
        }
        toast.success("Signed in offline");
      }
      navigate({ to: safeRedirect(search.redirect) as any, replace: true });
    } finally {
      setLoading(false);
    }
  };

  const signUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!online) return toast.error("Creating an account requires an internet connection.");
    setLoading(true);
    try {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName }, emailRedirectTo: window.location.origin },
      });
      if (error) return toast.error(error.message);

      const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
      if (signInErr) return toast.error(signInErr.message);

      await saveCredential({ email, password, fullName });
      await bootstrapDataPull({
        listProducts: () => listProductsFn(),
        listCategories: () => listCategoriesFn(),
        listSales: () => listSalesFn(),
        listInventoryTxns: () => listInventoryFn(),
        getMyRole: () => getMyRoleFn(),
        listUsers: () => listUsersFn(),
        getUserEmail: () => email,
      });
      toast.success("Account created — data cached for offline use");
      navigate({ to: safeRedirect(search.redirect) as any, replace: true });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background via-secondary to-background p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center text-center">
          <img src={logo.url} alt="Coffee Zone" className="h-24 w-24 rounded-full bg-white shadow-lg" />
          <h1 className="mt-4 font-display text-3xl font-bold">Coffee Zone</h1>
          <p className="text-sm text-muted-foreground">Sales & Inventory Management</p>
          {!online && (
            <p className="mt-2 text-xs font-medium text-amber-700">Offline mode — use a previously cached account</p>
          )}
        </div>
        <Card className="border-border/60 shadow-xl">
          <CardHeader>
            <CardTitle>Welcome</CardTitle>
            <CardDescription>Sign in to manage your coffee shop.</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="signin">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="signin">Sign in</TabsTrigger>
                <TabsTrigger value="signup" disabled={!online}>Create account</TabsTrigger>
              </TabsList>
              <TabsContent value="signin">
                <form onSubmit={signIn} className="space-y-3 pt-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="e1">Email</Label>
                    <Input id="e1" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="p1">Password</Label>
                    <Input id="p1" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
                  </div>
                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading ? "Signing in..." : online ? "Sign in" : "Sign in offline"}
                  </Button>
                </form>
              </TabsContent>
              <TabsContent value="signup">
                <form onSubmit={signUp} className="space-y-3 pt-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="n2">Full name</Label>
                    <Input id="n2" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="e2">Email</Label>
                    <Input id="e2" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="p2">Password</Label>
                    <Input id="p2" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />
                  </div>
                  <Button type="submit" className="w-full" disabled={loading || !online}>
                    {loading ? "Creating..." : "Create account"}
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    New accounts start as Cashier. Password is cached locally for offline sign-in after your first online login.
                  </p>
                </form>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
