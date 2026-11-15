import { useEffect } from "react";
import { useAuthStore } from "../auth/auth-store";
import { useCurrentUser } from "../auth/use-current-user";

declare global {
  interface Window {
    // Defined by the splash in index.html (the Markaz brand splash); it keeps itself up for at least 5 s.
    markazSplash?: { ready: () => void };
  }
}

// Tells the splash in index.html that the app is ready: the signed-in profile has loaded, or there is no session
// to load (the login page). The splash decides when to actually leave, so the whole animation is always seen.
export function SplashGate(): null {
  const hasSession = useAuthStore((state) => state.accessToken !== null);
  const { isPending } = useCurrentUser();
  const ready = !hasSession || !isPending;
  useEffect(() => {
    if (ready) window.markazSplash?.ready();
  }, [ready]);
  return null;
}
