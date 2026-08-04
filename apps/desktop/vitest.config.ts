import { resolve } from "path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src/renderer/src"),
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/renderer/**/*.{test,spec}.{ts,tsx}"],
    setupFiles: ["./src/renderer/src/test/setup.ts"],
  },
});
