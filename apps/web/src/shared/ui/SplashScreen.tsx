import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Logo } from "./Logo";

const SEEN_KEY = "markaz-splash-seen";
const SHOW_MS = 2600;
const FADE_MS = 500;

function alreadySeen(): boolean {
  try {
    return window.sessionStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

// The welcome screen on first entry: the mark draws itself in, the name and tagline rise, a thin bar fills,
// then it fades away. Shown once per browser session (not on every route or refresh of the same visit).
export function SplashScreen(): React.JSX.Element | null {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<"show" | "fade" | "gone">(alreadySeen() ? "gone" : "show");

  useEffect(() => {
    if (phase !== "show") return undefined;
    try {
      window.sessionStorage.setItem(SEEN_KEY, "1");
    } catch {
      // storage blocked: the splash may simply show again next visit
    }
    const fade = window.setTimeout(() => setPhase("fade"), SHOW_MS);
    const gone = window.setTimeout(() => setPhase("gone"), SHOW_MS + FADE_MS);
    return () => {
      window.clearTimeout(fade);
      window.clearTimeout(gone);
    };
  }, [phase]);

  if (phase === "gone") return null;
  return (
    <div className={`mk-splash${phase === "fade" ? " mk-splash--out" : ""}`} role="presentation">
      <div className="mk-splash__body">
        <Logo variant="mark" size={132} animate name={t("app.name")} className="mk-splash__mark" />
        <div className="mk-splash__name">{t("app.name")}</div>
        <div className="mk-splash__tagline">{t("app.tagline")}</div>
        <div className="mk-splash__bar">
          <span />
        </div>
      </div>
    </div>
  );
}
