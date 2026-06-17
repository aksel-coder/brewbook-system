import { createFileRoute, useNavigate, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { toast } from "sonner";

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
    if (typeof window === "undefined") return;
    const { data } = await supabase.auth.getSession();
    if (data.session) {
      throw redirect({ to: safeRedirect(search.redirect) as any, replace: true });
    }
  },
  head: () => ({ meta: [{ title: "Sign in — Coffee Zone" }] }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const signIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return toast.error(error.message);
      if (!data.session) return toast.error("Could not establish a session. Please try again.");
      toast.success("Welcome back!");
      navigate({ to: safeRedirect(search.redirect) as any, replace: true });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background via-secondary to-background p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center text-center">
          <img src="/coffeLogo.jpg" alt="Coffee Zone" className="h-24 w-24 rounded-full bg-white shadow-lg" />
          <h1 className="mt-4 font-display text-3xl font-bold">Coffee Zone</h1>
          <p className="text-sm text-muted-foreground">Sales & Inventory Management</p>
        </div>
        <Card className="border-border/60 shadow-xl">
          <CardHeader>
            <CardTitle>Sign in</CardTitle>
            <CardDescription>Sign in to manage your coffee shop.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={signIn} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input id="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Signing in..." : "Sign in"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
