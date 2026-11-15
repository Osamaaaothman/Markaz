import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useAuthStore } from "../auth/auth-store";
import { useCurrentUser } from "../auth/use-current-user";

declare global {
  interface Window {
    // Defined by the external, CSP-compatible boot script.
    markazSplash?: { ready: () => void };
  }
}

// Tells the splash in index.html that the app is ready: the signed-in profile has loaded, or there is no session
// to load. Mounted inside the route Suspense boundary so the route has also loaded.
export function SplashGate(): null {
  const hasSession = useAuthStore((state) => state.accessToken !== null);
  const { isPending } = useCurrentUser();
  const { pathname } = useLocation();
  const ready = pathname === "/login" || !hasSession || !isPending;
  useEffect(() => {
    if (ready) window.markazSplash?.ready();
  }, [ready]);
  return null;
}
