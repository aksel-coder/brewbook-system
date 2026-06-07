import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  adjustInventory,
  createSale,
  deleteCategory,
  deleteProduct,
  listCategories,
  listInventoryTxns,
  listProducts,
  listSales,
  upsertCategory,
  upsertProduct,
} from "@/lib/api/coffee.functions";
import {
  claimFirstAdmin,
  deleteUser,
  getMyRole,
  listUsers,
  updateUserRole,
} from "@/lib/api/users.functions";
import { supabase } from "@/integrations/supabase/client";
import { restoreOnlineSessionFromCredentials } from "@/lib/offline/auth-offline";
import { fullSync, getTotalPendingCount } from "@/lib/offline/sync";
import { useOnlineStatus } from "./use-online-status";
import { toast } from "sonner";

export function useOfflineSync() {
  const online = useOnlineStatus();
  const qc = useQueryClient();
  const listProductsFn = useServerFn(listProducts);
  const listCategoriesFn = useServerFn(listCategories);
  const listSalesFn = useServerFn(listSales);
  const listInventoryFn = useServerFn(listInventoryTxns);
  const getMyRoleFn = useServerFn(getMyRole);
  const listUsersFn = useServerFn(listUsers);
  const createSaleFn = useServerFn(createSale);
  const adjustFn = useServerFn(adjustInventory);
  const upsertProductFn = useServerFn(upsertProduct);
  const deleteProductFn = useServerFn(deleteProduct);
  const upsertCategoryFn = useServerFn(upsertCategory);
  const deleteCategoryFn = useServerFn(deleteCategory);
  const updateUserRoleFn = useServerFn(updateUserRole);
  const deleteUserFn = useServerFn(deleteUser);
  const claimAdminFn = useServerFn(claimFirstAdmin);
  const [syncing, setSyncing] = useState(false);

  const { data: pendingCount = 0 } = useQuery({
    queryKey: ["offline-pending"],
    queryFn: async () => {
      if (typeof indexedDB === "undefined") return 0;
      return getTotalPendingCount();
    },
  });

  useEffect(() => {
    if (!online) return;

    let cancelled = false;

    const run = async () => {
      setSyncing(true);
      try {
        await restoreOnlineSessionFromCredentials();
        const { data: auth } = await supabase.auth.getUser();
        const { synced, failed } = await fullSync({
          createSale: (input) => createSaleFn(input),
          adjustInventory: (input) => adjustFn(input),
          upsertProduct: (input) => upsertProductFn(input),
          deleteProduct: (input) => deleteProductFn(input),
          upsertCategory: (input) => upsertCategoryFn(input),
          deleteCategory: (input) => deleteCategoryFn(input),
          updateUserRole: (input) => updateUserRoleFn(input),
          deleteUser: (input) => deleteUserFn(input),
          claimFirstAdmin: () => claimAdminFn(),
          pull: {
            listProducts: () => listProductsFn(),
            listCategories: () => listCategoriesFn(),
            listSales: () => listSalesFn(),
            listInventoryTxns: () => listInventoryFn(),
            getMyRole: () => getMyRoleFn(),
            listUsers: () => listUsersFn(),
            getUserEmail: () => auth.user?.email ?? null,
          },
        });

        if (!cancelled) {
          qc.invalidateQueries({ queryKey: ["offline-pending"] });
          qc.invalidateQueries();
          if (synced > 0) {
            toast.success(`Synced ${synced} offline change${synced === 1 ? "" : "s"}`);
          } else if (failed > 0) {
            toast.error(`${failed} offline change${failed === 1 ? "" : "s"} could not be synced`);
          }
        }
      } finally {
        if (!cancelled) setSyncing(false);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [online]);

  return { online, pendingCount, syncing };
}
