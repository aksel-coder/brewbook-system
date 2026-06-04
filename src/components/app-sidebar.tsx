import { Link, useRouterState } from "@tanstack/react-router";
import { LayoutDashboard, ShoppingCart, Package, Boxes, BarChart3, Users, LogOut, Coffee, History } from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarHeader, SidebarFooter,
} from "@/components/ui/sidebar";
import logo from "@/assets/coffee-zone-logo.jpg.asset.json";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const nav = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "Sales (POS)", url: "/sales", icon: ShoppingCart },
  { title: "Sales History", url: "/sales/history", icon: History },
  { title: "Inventory", url: "/inventory", icon: Boxes },
  { title: "Products", url: "/products", icon: Package },
  { title: "Reports", url: "/reports", icon: BarChart3 },
];

export function AppSidebar({ isAdmin }: { isAdmin: boolean }) {
  const path = useRouterState({ select: (r) => r.location.pathname });
  const items = isAdmin ? [...nav, { title: "Users", url: "/users", icon: Users }] : nav;

  const signOut = async () => {
    await supabase.auth.signOut();
    toast.success("Signed out");
    window.location.href = "/login";
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border">
        <div className="flex items-center gap-3 px-2 py-3">
          <img src={logo.url} alt="Coffee Zone" className="h-10 w-10 rounded-full bg-white object-cover" />
          <div className="group-data-[collapsible=icon]:hidden">
            <div className="font-display text-lg font-bold leading-tight text-sidebar-foreground">Coffee Zone</div>
            <div className="text-xs text-sidebar-foreground/70">Sales & Inventory</div>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((it) => {
                const active = path === it.url;
                return (
                  <SidebarMenuItem key={it.url}>
                    <SidebarMenuButton asChild isActive={active} tooltip={it.title}>
                      <Link to={it.url}>
                        <it.icon className="h-4 w-4" />
                        <span>{it.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={signOut} tooltip="Sign out">
              <LogOut className="h-4 w-4" />
              <span>Sign out</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <div className="flex items-center gap-2 px-2 pb-2 pt-1 text-xs text-sidebar-foreground/60 group-data-[collapsible=icon]:hidden">
            <Coffee className="h-3 w-3" /> Start your day right
          </div>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
