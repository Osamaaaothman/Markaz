// Production only: in `vite dev` a service worker would serve stale modules and fight hot reload.
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      /* the app works fine without the worker; it only adds installability and the offline page */
    });
  });
}
