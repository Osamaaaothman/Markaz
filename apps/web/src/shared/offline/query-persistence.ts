import { dehydrate, hydrate, type DehydratedState } from "@tanstack/react-query";
import { queryClient } from "../api/query-client";
import { useAuthStore } from "../auth/auth-store";
import { tokenPrincipal } from "../auth/token-principal";
import { deletePersistedCache, readPersistedCache, writePersistedCache } from "./persisted-cache-db";

// Saves the server data the user has already looked at, on this device, so those screens still open offline
// (read-only: see offline-error.ts). Safeguards, because this is financial data sitting in the browser:
//  - the copy belongs to ONE signed-in user; a different user (or no user) finds it deleted, never shown;
//  - logging out deletes it immediately (auth-store.clear), and it expires after MAX_AGE_MS anyway;
//  - it is only ever shown offline or until fresh data arrives: online, every query is stale after 30 s and refetched;
//  - pictures/attachment bytes are not saved.
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const SAVE_DELAY_MS = 2000;
const NOT_SAVED: ReadonlySet<string> = new Set(["api-image"]);

interface Snapshot {
  readonly version: 1;
  readonly principal: string;
  readonly savedAt: number;
  readonly state: DehydratedState;
}

function isSnapshot(value: unknown): value is Snapshot {
  if (value === null || typeof value !== "object") return false;
  const v = value as Partial<Snapshot>;
  return v.version === 1 && typeof v.principal === "string" && typeof v.savedAt === "number" && v.state !== undefined;
}

function currentPrincipal(): string | null {
  return tokenPrincipal(useAuthStore.getState().accessToken);
}

async function restore(): Promise<void> {
  const stored = await readPersistedCache();
  if (stored === undefined) return;
  const principal = currentPrincipal();
  if (!isSnapshot(stored) || principal === null || stored.principal !== principal || Date.now() - stored.savedAt > MAX_AGE_MS) {
    await deletePersistedCache();
    return;
  }
  hydrate(queryClient, stored.state);
}

async function save(): Promise<void> {
  const principal = currentPrincipal();
  if (principal === null) {
    await deletePersistedCache();
    return;
  }
  try {
    const state = dehydrate(queryClient, {
      shouldDehydrateQuery: (query) => query.state.status === "success" && !NOT_SAVED.has(String(query.queryKey[0])),
    });
    const snapshot: Snapshot = { version: 1, principal, savedAt: Date.now(), state };
    await writePersistedCache(snapshot);
  } catch {
    /* something in the cache could not be copied: skip this save, the next change retries */
  }
}

// Called once from main.tsx. Restores first, and only then starts saving, so an empty cache at boot can never
// overwrite the saved copy.
export function startQueryPersistence(): void {
  if (typeof indexedDB === "undefined") return;
  void restore().finally(() => {
    let timer: number | undefined;
    queryClient.getQueryCache().subscribe(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void save(), SAVE_DELAY_MS);
    });
  });
}
