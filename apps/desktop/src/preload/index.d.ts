import { ElectronAPI } from "@electron-toolkit/preload";

export interface SecureStorageApi {
  set: (key: string, value: string) => Promise<boolean>;
  get: (key: string) => Promise<string | null>;
  delete: (key: string) => Promise<boolean>;
}

export interface DesktopApi {
  secureStorage: SecureStorageApi;
}

declare global {
  interface Window {
    electron: ElectronAPI;
    api: DesktopApi;
  }
}
