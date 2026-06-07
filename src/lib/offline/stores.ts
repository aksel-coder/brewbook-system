import { openDB } from "./db";

export async function replaceAll<T extends { id: string }>(storeName: string, items: T[]) {
  const db = await openDB();
  const tx = db.transaction(storeName, "readwrite");
  const store = tx.objectStore(storeName);
  store.clear();
  for (const item of items) store.put(item);
  await txComplete(tx);
}

export async function getAll<T>(storeName: string): Promise<T[]> {
  const db = await openDB();
  const tx = db.transaction(storeName, "readonly");
  const store = tx.objectStore(storeName);
  const request = store.getAll();
  const items = await idbRequest<T[]>(request);
  await txComplete(tx);
  return items;
}

export async function put<T>(storeName: string, item: T) {
  const db = await openDB();
  const tx = db.transaction(storeName, "readwrite");
  tx.objectStore(storeName).put(item);
  await txComplete(tx);
}

export async function remove(storeName: string, id: string) {
  const db = await openDB();
  const tx = db.transaction(storeName, "readwrite");
  tx.objectStore(storeName).delete(id);
  await txComplete(tx);
}

export async function getMeta<T>(key: string): Promise<T | null> {
  const db = await openDB();
  const tx = db.transaction("meta", "readonly");
  const request = tx.objectStore("meta").get(key);
  const row = await idbRequest<{ key: string; value: T } | undefined>(request);
  await txComplete(tx);
  return row?.value ?? null;
}

export async function setMeta<T>(key: string, value: T) {
  await put("meta", { key, value });
}

function idbRequest<T>(request: IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result as T);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function txComplete(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}
