export type OfflineSaleItem = {
  product_id: string;
  variant_id?: string;
  name: string;
  variant_name?: string;
  price: number;
  quantity: number;
  expectedRecipe: { item_id: string; quantity_required: number }[];
};

export type OfflineSale = {
  id: string;
  ownerId: string;
  receipt_number: string;
  sale_date: string;
  subtotal: number;
  tax: number;
  total_amount: number;
  items: OfflineSaleItem[];
  syncStatus: "pending" | "synced" | "conflict";
  syncError?: string;
};

type OfflineState = {
  id: string;
  verifiedAdmin?: { ownerId: string; verifiedAt: string };
  products?: { ownerId: string; savedAt: string; rows: any[]; inventory: any[] };
  sales?: OfflineSale[];
  salesSnapshot?: { ownerId: string; savedAt: string; rows: any[] };
  dashboard?: { ownerId: string; rangeKey: string; stats: any };
};

const DB_NAME = "coffee-zone-offline";
const DB_VERSION = 1;
const STORE = "state";
const STATE_KEY = "shared";

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("Offline storage is unavailable."));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open offline storage."));
  });
}

async function updateState<T>(update: (state: OfflineState) => T): Promise<T> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, "readwrite");
    const store = transaction.objectStore(STORE);
    const getRequest = store.get(STATE_KEY);
    let result: T;
    getRequest.onsuccess = () => {
      const state = (getRequest.result as OfflineState | undefined) ?? { id: STATE_KEY };
      result = update(state);
      store.put(state);
    };
    transaction.oncomplete = () => { db.close(); resolve(result); };
    transaction.onerror = () => { db.close(); reject(transaction.error ?? new Error("Offline storage update failed.")); };
    transaction.onabort = () => { db.close(); reject(transaction.error ?? new Error("Offline storage update was aborted.")); };
  });
}

async function readState(): Promise<OfflineState> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, "readonly");
    const request = transaction.objectStore(STORE).get(STATE_KEY);
    request.onsuccess = () => resolve((request.result as OfflineState | undefined) ?? { id: STATE_KEY });
    request.onerror = () => reject(request.error ?? new Error("Could not read offline storage."));
    transaction.oncomplete = () => db.close();
  });
}

export async function rememberVerifiedAdmin(ownerId: string) {
  await updateState(state => { state.verifiedAdmin = { ownerId, verifiedAt: new Date().toISOString() }; });
}

export async function forgetVerifiedAdmin(ownerId: string) {
  await updateState(state => {
    if (state.verifiedAdmin?.ownerId === ownerId) delete state.verifiedAdmin;
  });
}

export async function hasVerifiedAdmin(ownerId: string) {
  const state = await readState();
  return state.verifiedAdmin?.ownerId === ownerId;
}

export async function cacheOfflineProducts(ownerId: string, rows: any[], inventory: any[]) {
  await updateState(state => { state.products = { ownerId, savedAt: new Date().toISOString(), rows, inventory }; });
}

export async function getOfflineProducts(ownerId: string): Promise<any[] | undefined> {
  const state = await readState();
  return state.products?.ownerId === ownerId ? state.products.rows : undefined;
}

export async function getOfflineInventory(ownerId: string): Promise<any[] | undefined> {
  const state = await readState();
  return state.products?.ownerId === ownerId ? state.products.inventory : undefined;
}

export async function cacheOfflineDashboard(ownerId: string, rangeKey: string, stats: any) {
  await updateState(state => { state.dashboard = { ownerId, rangeKey, stats }; });
}

export async function getOfflineDashboard(ownerId: string, rangeKey: string) {
  const state = await readState();
  return state.dashboard?.ownerId === ownerId && state.dashboard.rangeKey === rangeKey
    ? state.dashboard.stats
    : undefined;
}

export async function getOfflineSales(ownerId: string) {
  const state = await readState();
  return (state.sales ?? []).filter(sale => sale.ownerId === ownerId);
}

export async function cacheOnlineSales(ownerId: string, rows: any[]) {
  await updateState(state => {
    state.salesSnapshot = { ownerId, savedAt: new Date().toISOString(), rows };
  });
}

export async function getCachedOnlineSales(ownerId: string) {
  const state = await readState();
  return state.salesSnapshot?.ownerId === ownerId ? state.salesSnapshot.rows : undefined;
}

export async function saveOfflineSale(sale: OfflineSale) {
  await updateState(state => {
    state.sales = [...(state.sales ?? []).filter(item => item.id !== sale.id), sale];
  });
}

export async function commitOfflineSale(
  sale: OfflineSale,
  products: any[],
  inventory: any[],
) {
  await updateState(state => {
    state.products = {
      ownerId: sale.ownerId,
      savedAt: new Date().toISOString(),
      rows: products,
      inventory,
    };
    state.sales = [...(state.sales ?? []).filter(item => item.id !== sale.id), sale];
  });
}

export async function updateOfflineSale(id: string, update: Partial<OfflineSale>) {
  await updateState(state => {
    state.sales = (state.sales ?? []).map(sale => sale.id === id ? { ...sale, ...update } : sale);
  });
}

export async function retryOfflineSale(id: string) {
  await updateOfflineSale(id, { syncStatus: "pending", syncError: undefined });
}

export async function saveOfflineInventory(ownerId: string, products: any[]) {
  const state = await readState();
  if (state.products?.ownerId === ownerId) await cacheOfflineProducts(ownerId, state.products.rows, products);
}

export async function syncPendingOfflineSales(
  ownerId: string,
  sync: (sale: OfflineSale) => Promise<void>,
) {
  const pending = (await getOfflineSales(ownerId)).filter(sale => sale.syncStatus === "pending");
  for (const sale of pending) {
    try {
      await sync(sale);
      await updateOfflineSale(sale.id, { syncStatus: "synced", syncError: undefined });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isInventoryConflict = /insufficient|unavailable|invalid sale|recipe|price changed/i.test(message);
      await updateOfflineSale(sale.id, {
        syncStatus: isInventoryConflict ? "conflict" : "pending",
        syncError: message,
      });
      if (!isInventoryConflict) break;
    }
  }
}

export function asHistorySale(sale: OfflineSale) {
  return {
    id: sale.id,
    receipt_number: sale.receipt_number,
    sale_date: sale.sale_date,
    subtotal: sale.subtotal,
    tax: sale.tax,
    total_amount: sale.total_amount,
    offline_status: sale.syncStatus === "synced" ? "Synced" : sale.syncStatus === "conflict" ? "Sync issue" : "Pending Sync",
    sale_items: sale.items.map(item => ({
      product_id: item.product_id,
      quantity: item.quantity,
      unit_price: item.price,
      variant_name: item.variant_name ?? null,
      products: { name: item.name },
    })),
  };
}
