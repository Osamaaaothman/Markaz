import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { LogoMark } from "../ui/Logo";
import { isIosSafari, isStandalone, rememberDismissed, wasRecentlyDismissed } from "./install-state";
import { usePwaInstallStore } from "./pwa-install-store";
import "./install-prompt.css";

// Let the user get oriented before asking for anything.
const SHOW_DELAY_MS = 4000;

// Offers to install Markaz as an app. Chromium browsers get a one-tap Install button (the captured native
// prompt); iOS Safari has no such API, so it gets the two-step Share, Add to Home Screen instructions.
// Hidden when already installed/running standalone, or after "Not now" for a cooldown period.
export function InstallPrompt(): React.JSX.Element | null {
  const { t } = useTranslation();
  const deferred = usePwaInstallStore((state) => state.deferred);
  const installed = usePwaInstallStore((state) => state.installed);
  const manualOpen = usePwaInstallStore((state) => state.manualOpen);
  const [ready, setReady] = useState(false);
  const [hidden, setHidden] = useState(() => isStandalone() || wasRecentlyDismissed());
  const [busy, setBusy] = useState(false);
  const iosGuide = isIosSafari();

  useEffect(() => {
    const timer = window.setTimeout(() => setReady(true), SHOW_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);

  if (installed || isStandalone() || (!manualOpen && (hidden || !ready || (!deferred && !iosGuide)))) return null;

  const dismiss = (): void => {
    rememberDismissed();
    setHidden(true);
    usePwaInstallStore.getState().closeInstall();
  };

  const install = async (): Promise<void> => {
    if (!deferred) return;
    setBusy(true);
    usePwaInstallStore.getState().setDeferred(null);
    try {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      // The browser allows a captured event to be used once; either way it is spent now.
      usePwaInstallStore.getState().setDeferred(null);
      if (choice.outcome === "dismissed") rememberDismissed();
      setHidden(true);
      usePwaInstallStore.getState().closeInstall();
    } catch {
      // Keep the manual instructions available if the browser cannot open its prompt.
    } finally {
      setBusy(false);
    }
  };

  const manual = iosGuide && !deferred;

  return (
    <section className="mk-install" role="dialog" aria-labelledby="mk-install-title" aria-describedby="mk-install-body">
      <div className="mk-install__icon" aria-hidden="true">
        <LogoMark size={44} />
      </div>
      <div className="mk-install__text">
        <h2 id="mk-install-title" className="mk-install__title">{t("pwa.install.title")}</h2>
        <p id="mk-install-body" className="mk-install__body">
          {manual ? t("pwa.install.iosBody") : deferred ? t("pwa.install.body") : t("pwa.install.browserGuide")}
        </p>
        {manual ? (
          <ol className="mk-install__steps">
            <li>{t("pwa.install.iosStepShare")}</li>
            <li>{t("pwa.install.iosStepAdd")}</li>
          </ol>
        ) : null}
        <div className="mk-install__actions">
          {deferred ? (
            <button type="button" className="mk-install__btn mk-install__btn--primary" onClick={() => void install()} disabled={busy}>
              <i className="pi pi-download" aria-hidden="true" /> {t("pwa.install.action")}
            </button>
          ) : null}
          <button type="button" className="mk-install__btn" onClick={dismiss}>
            {deferred ? t("pwa.install.later") : t("pwa.install.gotIt")}
          </button>
        </div>
      </div>
      <button type="button" className="mk-install__close" onClick={dismiss} aria-label={t("pwa.install.close")}>
        <i className="pi pi-times" aria-hidden="true" />
      </button>
    </section>
  );
}
