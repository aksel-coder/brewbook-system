import { createFileRoute, useNavigate, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { getMyRole } from "@/lib/api/users.functions";
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

const cashierRedirect = (value: unknown) => {
  const destination = safeRedirect(value);
  const pathname = new URL(destination, window.location.origin).pathname.replace(/\/+$/, "") || "/";
  return pathname === "/sales" || pathname === "/sales/history" ? destination : "/sales";
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
  const fetchRole = useServerFn(getMyRole);
  const search = Route.useSearch();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [verificationError, setVerificationError] = useState("");

  const verifyAccessAndContinue = async () => {
    setVerificationError("");
    try {
      const role = await fetchRole();
      toast.success("Welcome back!");
      navigate({
        to: (role.isAdmin ? safeRedirect(search.redirect) : cashierRedirect(search.redirect)) as any,
        replace: true,
      });
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : "";
      const message =
        /fetch failed|failed to fetch|networkerror|timeout|temporarily unavailable/i.test(rawMessage)
          ? "A temporary connection problem prevented account verification. Please retry."
          : rawMessage ||
            "Your account role could not be verified. Retry the check or contact an administrator.";
      setVerificationError(message);
      toast.error(message);
    }
  };

  const signIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setVerificationError("");
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        toast.error(error.message);
        return;
      }
      if (!data.session) {
        toast.error("Could not establish a session. Please try again.");
        return;
      }
      await verifyAccessAndContinue();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background via-secondary to-background p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center text-center">
          <img
            src="/coffee-zone-logo.png"
            alt="Coffee Zone"
            className="h-24 w-24 rounded-full bg-white object-contain shadow-lg"
          />
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
              {verificationError && (
                <div role="alert" className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
                  <p className="text-sm text-destructive">{verificationError}</p>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    disabled={loading}
                    onClick={async () => {
                      setLoading(true);
                      try {
                        await verifyAccessAndContinue();
                      } finally {
                        setLoading(false);
                      }
                    }}
                  >
                    Retry access verification
                  </Button>
                </div>
              )}
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
