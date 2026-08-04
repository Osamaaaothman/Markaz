import { contextBridge } from "electron";
import { electronAPI } from "@electron-toolkit/preload";

// Bridges main-process capabilities (OS notifications, connection-state
// events, etc.) into the renderer without exposing raw Node/Electron APIs.
const api = {};

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld("electron", electronAPI);
    contextBridge.exposeInMainWorld("api", api);
  } catch (error) {
    console.error(error);
  }
} else {
  // @ts-expect-error - fallback for contextIsolation disabled
  window.electron = electronAPI;
  // @ts-expect-error - fallback for contextIsolation disabled
  window.api = api;
}
