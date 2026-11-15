import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "../auth/auth-store";
import { useCurrentUser } from "../auth/use-current-user";
import { WORDMARK_AR, WORDMARK_EN } from "./splash-wordmarks";

// The intro is never cut short, whatever loads faster (the brand package's 1.5 s rule).
const INTRO_MS = 1500;
const SLOW_MS = 4000;
const LEAVE_MS = 220;

// The Markaz splash from the brand package (splash/splash.html), as a component: the four frame brackets draw in
// one after another, the brass centre pops in, a shine sweeps across, and the wordmark rises. If the app is not
// ready yet it keeps a calm pulse going, and after 4 s says it is preparing the data. It is shown on every full
// page load (entering the site or refreshing) and never when moving between pages inside the app. "Ready" means
// the signed-in profile has loaded, or there is no session to load (the login page).
export function SplashScreen(): React.JSX.Element | null {
  const { t, i18n } = useTranslation();
  const hasSession = useAuthStore((state) => state.accessToken !== null);
  const { isPending } = useCurrentUser();
  const appReady = !hasSession || !isPending;

  const [introDone, setIntroDone] = useState(false);
  const [slow, setSlow] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    const intro = window.setTimeout(() => setIntroDone(true), INTRO_MS);
    const late = window.setTimeout(() => setSlow(true), SLOW_MS);
    return () => {
      window.clearTimeout(intro);
      window.clearTimeout(late);
    };
  }, []);

  const ready = introDone && appReady;
  useEffect(() => {
    if (!ready) return undefined;
    setLeaving(true);
    const done = window.setTimeout(() => setGone(true), LEAVE_MS);
    return () => window.clearTimeout(done);
  }, [ready]);

  if (gone) return null;
  const arabic = i18n.language.startsWith("ar");
  const classes = ["mk-splash", introDone && !leaving ? "mk-splash--waiting" : "", slow ? "mk-splash--slow" : "", leaving ? "mk-splash--leaving" : ""].filter(Boolean).join(" ");
  return (
    <div className={classes} role="status" aria-label={t("app.name")}>
      <svg className="mk-splash__mark" viewBox="0 0 48 48" aria-hidden="true">
        <defs>
          <mask id="mk-splash-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="48" height="48">
            <g fill="none" stroke="#fff" strokeWidth="6">
              <path d="M6 21V6H21" />
              <path d="M27 6H42V21" />
              <path d="M42 27V42H27" />
              <path d="M21 42H6V27" />
            </g>
            <rect x="18" y="18" width="12" height="12" fill="#fff" />
          </mask>
        </defs>
        <g className="mk-splash__frame">
          <path d="M6 21V6H21" pathLength="1" />
          <path d="M27 6H42V21" pathLength="1" />
          <path d="M42 27V42H27" pathLength="1" />
          <path d="M21 42H6V27" pathLength="1" />
        </g>
        <rect className="mk-splash__centre" x="18" y="18" width="12" height="12" />
        <g mask="url(#mk-splash-mask)">
          <g className="mk-splash__shine">
            <polygon points="0,-4 10,-4 -2,52 -12,52" />
          </g>
        </g>
      </svg>
      {arabic ? (
        <svg className="mk-splash__word" viewBox="0 0 61.6 38.8" width="77" height="48" role="img" aria-label={t("app.name")}>
          <path transform={WORDMARK_AR.transform} d={WORDMARK_AR.d} />
        </svg>
      ) : (
        <svg className="mk-splash__word" viewBox="0 0 113.3 25.6" width="142" height="32" role="img" aria-label={t("app.name")}>
          <path transform={WORDMARK_EN.transform} d={WORDMARK_EN.d} />
        </svg>
      )}
      <p className="mk-splash__status">{t("app.preparing")}</p>
    </div>
  );
}
