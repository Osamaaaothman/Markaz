// A single-record IndexedDB store holding the saved copy of the query cache. No dependencies on the auth store
// or the query client, so the auth store can import deletePersistedCache() on logout without a cycle.
const DB_NAME = "erp-offline";
const STORE = "cache";
const KEY = "queries";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB unavailable"));
  });
}

async function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = work(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
      tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
    });
  } finally {
    db.close();
  }
}

export async function readPersistedCache(): Promise<unknown> {
  try {
    return await run("readonly", (store) => store.get(KEY));
  } catch {
    return undefined;
  }
}

export async function writePersistedCache(value: unknown): Promise<void> {
  try {
    await run("readwrite", (store) => store.put(value, KEY));
  } catch {
    /* private mode / quota: the app simply has nothing to show offline next time */
  }
}

// Called on logout and whenever the saved copy belongs to someone else: financial data must not outlive the session.
export async function deletePersistedCache(): Promise<void> {
  try {
    if (typeof indexedDB === "undefined") return;
    await run("readwrite", (store) => store.delete(KEY));
  } catch {
    /* nothing stored, or storage blocked */
  }
}
