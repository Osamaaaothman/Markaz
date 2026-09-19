import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  // Vite only auto-loads .env files into import.meta.env for CLIENT code — this
  // config file runs in Node, so the proxy target needs an explicit loadEnv call
  // to pick up apps/web/.env.local (gitignored, for a developer's own machine).
  const env = loadEnv(mode, process.cwd(), "VITE_");

  return {
    plugins: [react()],
    server: {
      host: true,
      port: 5173,
      // Mirrors docker/web.nginx.conf's /api/ -> api:3000 proxy exactly, so the
      // frontend always calls same-origin /api/v1/... in both dev and production —
      // no CORS configuration needed on the API at all.
      proxy: {
        "/api": {
          // Points at the API's HOST port (API_HOST_PORT in .env, default 3000 —
          // .env.example), not the container-internal one — set
          // VITE_API_PROXY_TARGET in apps/web/.env.local if this machine's .env
          // changed API_HOST_PORT.
          target: env.VITE_API_PROXY_TARGET || "http://localhost:3000",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ""),
        },
      },
    },
  };
});
