const DISMISSED_KEY = "erp-pwa-install-dismissed";
// "Not now" hides the prompt for two weeks; asking on every visit would be nagging.
export const DISMISS_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000;

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return iosStandalone || window.matchMedia("(display-mode: standalone)").matches;
}

// iOS/iPadOS Safari never fires `beforeinstallprompt`; installation is the manual Share -> Add to Home Screen.
export function isIosSafari(): boolean {
  const ua = navigator.userAgent;
  const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  // Other iOS browsers (Chrome/Firefox/Edge/Opera) embed the engine but their menus differ, so only guide Safari.
  return ios && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
}

export function wasRecentlyDismissed(now: number = Date.now()): boolean {
  try {
    const at = Number(localStorage.getItem(DISMISSED_KEY));
    return Number.isFinite(at) && at > 0 && now - at < DISMISS_COOLDOWN_MS;
  } catch {
    return false;
  }
}

export function rememberDismissed(now: number = Date.now()): void {
  try {
    localStorage.setItem(DISMISSED_KEY, String(now));
  } catch {
    /* private mode: the prompt may reappear next visit */
  }
}
