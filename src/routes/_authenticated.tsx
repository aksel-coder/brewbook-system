import { createFileRoute, Outlet, redirect, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMyRole } from "@/lib/api/users.functions";
import { forgetVerifiedAdmin, hasVerifiedAdmin, rememberVerifiedAdmin, syncPendingOfflineSales } from "@/lib/offline";
import { syncOfflineSale } from "@/lib/api/coffee.functions";

const adminOnlyPaths = new Set([
  "/dashboard",
  "/inventory",
  "/products",
  "/reservations",
  "/reports",
  "/users",
]);

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      throw redirect({
        to: "/login",
        search: { redirect: location.href } as any,
        replace: true,
      });
    }
    const pathname = location.pathname.replace(/\/+$/, "") || "/";
    if (!navigator.onLine) {
      const verified = await hasVerifiedAdmin(data.session.user.id);
      if (!verified) {
        if (adminOnlyPaths.has(pathname)) throw redirect({ to: "/sales", replace: true });
        return;
      }
      if (["/inventory", "/products", "/reservations", "/users"].includes(pathname)) {
        throw redirect({ to: "/sales", replace: true });
      }
      if (adminOnlyPaths.has(pathname)) return;
    }
    if (adminOnlyPaths.has(pathname)) {
      try {
        const role = await getMyRole();
        if (!role.isAdmin) throw redirect({ to: "/sales", replace: true });
      } catch (error) {
        if (navigator.onLine || !(await hasVerifiedAdmin(data.session.user.id))) throw error;
      }
    }
  },
  component: AuthLayout,
});

function AuthLayout() {
  const router = useRouter();
  const qc = useQueryClient();
  const fetchRole = useServerFn(getMyRole);
  const { data: me, refetch, isLoading: meLoading, isFetching: meFetching, error: meError } = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        return await fetchRole();
      } catch (error) {
        const { data: { session } } = await supabase.auth.getSession();
        if (navigator.onLine || !session || !(await hasVerifiedAdmin(session.user.id))) throw error;
        return {
          userId: session.user.id,
          isAdmin: true,
          role: "admin",
          fullName: String(session.user.user_metadata?.full_name ?? ""),
          username: session.user.email?.split("@")[0] ?? "",
        };
      }
    },
    refetchOnWindowFocus: true,
    refetchOnMount: "always",
  });
  const syncFn = useServerFn(syncOfflineSale);

  useEffect(() => {
    if (me?.isAdmin) {
      void rememberVerifiedAdmin(me.userId).catch(error => console.error("Could not save verified admin status:", error));
    } else if (me && navigator.onLine) {
      void forgetVerifiedAdmin(me.userId).catch(error => console.error("Could not clear stale admin status:", error));
    }
  }, [me]);

  useEffect(() => {
    const sync = async () => {
      if (!navigator.onLine) return;
      const { data: { session } } = await supabase.auth.getSession();
      if (!session || !(await hasVerifiedAdmin(session.user.id))) return;
      await syncPendingOfflineSales(session.user.id, async sale => {
        await syncFn({
          data: {
            id: sale.id,
            items: sale.items.map(item => ({
              product_id: item.product_id,
              variant_id: item.variant_id ?? null,
              quantity: item.quantity,
              expected_unit_price: item.price,
              expected_recipe: item.expectedRecipe,
            })),
          },
        });
      });
      qc.invalidateQueries({ queryKey: ["sales"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    };
    void sync();
    window.addEventListener("online", sync);
    window.addEventListener("coffee-zone-retry-offline-sync", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("coffee-zone-retry-offline-sync", sync);
    };
  }, [qc, syncFn]);

  useEffect(() => {
    console.log("[AuthLayout] session/role state:", {
      meLoading,
      meFetching,
      meError: meError ? (meError as Error).message : null,
      me,
    });
  }, [me, meLoading, meFetching, meError]);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      console.log("[AuthLayout] auth state:", event, session?.user?.id ?? "no session");
      if (event === "SIGNED_OUT") {
        router.navigate({ to: "/login", search: {}, replace: true });
      }
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
        qc.invalidateQueries({ queryKey: ["me"] });
      }
    });
    return () => subscription.unsubscribe();
  }, [router, qc]);

  useEffect(() => {
    const onVisible = async () => {
      if (document.visibilityState !== "visible") return;
      console.log("[AuthLayout] tab visible — refreshing session + queries");
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        const now = Math.floor(Date.now() / 1000);
        const expiresAt = session.expires_at ?? 0;
        if (expiresAt - now < 300) {
          await supabase.auth.refreshSession();
        }
      }
      refetch();
      qc.invalidateQueries();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refetch, qc]);

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background">
        <AppSidebar isAdmin={!!me?.isAdmin} />
        <div className="flex flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-card/80 px-4 backdrop-blur">
            <SidebarTrigger />
            <div className="flex-1" />
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
