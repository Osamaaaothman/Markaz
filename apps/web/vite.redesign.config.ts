import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

// Separate, fixture-only entry. No app routes, credentials, API proxy or production build changes.
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5186,
    strictPort: true,
    watch: { awaitWriteFinish: { stabilityThreshold: 250, pollInterval: 50 } },
  },
  preview: { host: "127.0.0.1", port: 4186, strictPort: true },
  build: {
    outDir: "../../output/redesign-preview",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        redesign: fileURLToPath(new URL("redesign.html", import.meta.url)),
        appearance: fileURLToPath(new URL("appearance.html", import.meta.url)),
      },
    },
  },
});
