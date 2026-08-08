import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app, ipcMain, safeStorage } from "electron";

// Backs the refresh token (and anything else credential-shaped) with the
// OS keychain (Keychain/DPAPI/libsecret via Electron's safeStorage),
// never plain text. If encryption genuinely isn't available on this
// machine, we skip persisting rather than fall back to plain text --
// the user just has to log in again next launch.

function storePath(): string {
  return join(app.getPath("userData"), "secure-storage.json");
}

function readStore(): Record<string, string> {
  const path = storePath();
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return {};
  }
}

function writeStore(store: Record<string, string>): void {
  mkdirSync(app.getPath("userData"), { recursive: true });
  writeFileSync(storePath(), JSON.stringify(store), "utf-8");
}

export function registerSecureStorageHandlers(): void {
  ipcMain.handle("secure-storage:set", (_event, key: string, value: string) => {
    if (!safeStorage.isEncryptionAvailable()) return false;
    const store = readStore();
    store[key] = safeStorage.encryptString(value).toString("base64");
    writeStore(store);
    return true;
  });

  ipcMain.handle("secure-storage:get", (_event, key: string) => {
    if (!safeStorage.isEncryptionAvailable()) return null;
    const encrypted = readStore()[key];
    if (!encrypted) return null;
    try {
      return safeStorage.decryptString(Buffer.from(encrypted, "base64"));
    } catch {
      return null;
    }
  });

  ipcMain.handle("secure-storage:delete", (_event, key: string) => {
    const store = readStore();
    delete store[key];
    writeStore(store);
    return true;
  });
}
