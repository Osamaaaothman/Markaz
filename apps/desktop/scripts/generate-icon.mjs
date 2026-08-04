// One-off asset generator: rasterizes branding/icon.svg to a PNG for use
// as the Electron window/taskbar icon, using Electron's own Chromium
// instead of adding an image-processing dependency just for this.
// Re-run with: node_modules/.bin/electron apps/desktop/scripts/generate-icon.mjs
// (regenerate whenever branding/icon.svg changes)
import { app, BrowserWindow } from "electron";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const size = 512;

app.disableHardwareAcceleration();

async function main() {
  const svg = readFileSync(join(__dirname, "../../../branding/icon.svg"), "utf-8");
  const html = `<!doctype html><html><head><style>
    html,body{margin:0;padding:0;background:transparent;}
    svg{width:${size}px;height:${size}px;display:block;}
  </style></head><body>${svg}</body></html>`;

  const win = new BrowserWindow({
    width: size,
    height: size,
    show: false,
    transparent: true,
    webPreferences: { offscreen: true },
  });

  const image = await new Promise((resolve) => {
    win.webContents.once("paint", (_event, _dirty, img) => resolve(img));
    win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  });

  const outDir = join(__dirname, "../resources");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "icon.png"), image.toPNG());

  console.log(`Wrote ${join(outDir, "icon.png")}`);
  app.quit();
}

app.whenReady().then(main);
