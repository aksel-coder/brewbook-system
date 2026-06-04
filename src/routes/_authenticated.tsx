import { createFileRoute, Outlet, redirect, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMyRole, claimFirstAdmin } from "@/lib/api/users.functions";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      throw redirect({ to: "/login" });
    }
  },
  component: AuthLayout,
});

function AuthLayout() {
  const router = useRouter();
  const fetchRole = useServerFn(getMyRole);
  const claim = useServerFn(claimFirstAdmin);
  const { data: me, refetch } = useQuery({ queryKey: ["me"], queryFn: () => fetchRole() });
  const [claiming, setClaiming] = useState(false);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") router.navigate({ to: "/login" });
    });
    return () => subscription.unsubscribe();
  }, [router]);

  const handleClaim = async () => {
    setClaiming(true);
    try {
      await claim();
      toast.success("You are now an administrator");
      refetch();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setClaiming(false);
    }
  };

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background">
        <AppSidebar isAdmin={!!me?.isAdmin} />
        <div className="flex flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-card/80 px-4 backdrop-blur">
            <SidebarTrigger />
            <div className="flex-1" />
            {me && !me.isAdmin && (
              <Button variant="outline" size="sm" onClick={handleClaim} disabled={claiming}>
                <ShieldCheck className="mr-1 h-4 w-4" /> Claim admin (first-time setup)
              </Button>
            )}
            {me && (
              <div className="hidden sm:flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">{me.fullName || me.username}</span>
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary capitalize">{me.role}</span>
              </div>
            )}
          </header>
          <main className="flex-1 p-4 md:p-6"><Outlet /></main>
        </div>
      </div>
    </SidebarProvider>
  );
}
