// Offline policy (decided for a financial system of record):
//  - READING works offline, from the copy of server data this device saved earlier (see query-persistence.ts).
//  - WRITING never does. Every change (posting an entry, issuing an invoice, stock, payments, settings, uploads)
//    is checked by the server against live state: closed periods, balances, document numbers, permissions,
//    ZATCA sequencing. Replaying it later against different state could post something the user never saw
//    accepted, so a write attempted offline is refused at once instead of queued.
export class OfflineError extends Error {
  readonly code = "OFFLINE";
  constructor() {
    super("This action needs an internet connection.");
    this.name = "OfflineError";
  }
}

export function isOfflineError(error: unknown): error is OfflineError {
  return error instanceof OfflineError;
}

export function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

const READ_METHODS: ReadonlySet<string> = new Set(["get", "head", "options"]);

export function isReadMethod(method: string | undefined): boolean {
  return READ_METHODS.has((method ?? "get").toLowerCase());
}
