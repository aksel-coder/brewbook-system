const DB_NAME = "coffee-zone-offline";
const DB_VERSION = 3;

const STORES = [
  "products",
  "categories",
  "sales",
  "sale_items",
  "inventory_transactions",
  "users",
  "credentials",
  "pendingSales",
  "pendingMutations",
  "meta",
] as const;

export type StoreName = (typeof STORES)[number];

export function isIndexedDBAvailable() {
  return typeof indexedDB !== "undefined";
}

export function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!isIndexedDBAvailable()) {
      reject(new Error("IndexedDB is not available"));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains("products")) {
        db.createObjectStore("products", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("categories")) {
        db.createObjectStore("categories", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("sales")) {
        db.createObjectStore("sales", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("sale_items")) {
        const store = db.createObjectStore("sale_items", { keyPath: "id" });
        store.createIndex("sale_id", "sale_id", { unique: false });
      }
      if (!db.objectStoreNames.contains("inventory_transactions")) {
        db.createObjectStore("inventory_transactions", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("users")) {
        db.createObjectStore("users", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("credentials")) {
        db.createObjectStore("credentials", { keyPath: "email" });
      }
      if (!db.objectStoreNames.contains("pendingSales")) {
        const store = db.createObjectStore("pendingSales", { keyPath: "id" });
        store.createIndex("status", "status", { unique: false });
        store.createIndex("created_at", "created_at", { unique: false });
      }
      if (!db.objectStoreNames.contains("pendingMutations")) {
        const store = db.createObjectStore("pendingMutations", { keyPath: "id" });
        store.createIndex("status", "status", { unique: false });
      }
      if (!db.objectStoreNames.contains("meta")) {
        db.createObjectStore("meta", { keyPath: "key" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Failed to open IndexedDB"));
  });
}

export async function withStore<T>(
  storeName: StoreName,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T> | Promise<T>,
): Promise<T> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);

    Promise.resolve(fn(store))
      .then((result) => {
        if (result instanceof IDBRequest) {
          result.onsuccess = () => resolve(result.result as T);
          result.onerror = () => reject(result.error ?? new Error(`IndexedDB request failed (${storeName})`));
        } else {
          tx.oncomplete = () => resolve(result);
          tx.onerror = () => reject(tx.error ?? new Error(`IndexedDB transaction failed (${storeName})`));
        }
      })
      .catch(reject);

    tx.onabort = () => reject(tx.error ?? new Error(`IndexedDB transaction aborted (${storeName})`));
  });
}
