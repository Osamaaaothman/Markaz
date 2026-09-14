import { useEffect } from "react";
import lightThemeUrl from "primereact/resources/themes/lara-light-indigo/theme.css?url";
import darkThemeUrl from "primereact/resources/themes/lara-dark-indigo/theme.css?url";
import { useThemeStore } from "./theme-store";

const LINK_ID = "prime-theme-link";

// PrimeReact's classic theme system ships one complete stylesheet per
// light/dark variant (not CSS-variable-driven light/dark within one file), so
// switching is a matter of pointing one <link> at a different built asset URL —
// the standard, documented technique for a runtime theme switch on this
// (still-current) styling API. `?url` gives the real hashed build output path
// (Vite feature) rather than inlining the CSS, so this stays one stylesheet
// swap, not two bundled copies fighting for specificity.
export function usePrimeTheme(): void {
  const mode = useThemeStore((state) => state.mode);

  useEffect(() => {
    let link = document.getElementById(LINK_ID) as HTMLLinkElement | null;
    if (link === null) {
      link = document.createElement("link");
      link.id = LINK_ID;
      link.rel = "stylesheet";
      document.head.appendChild(link);
    }
    link.href = mode === "dark" ? darkThemeUrl : lightThemeUrl;
    document.documentElement.dataset.themeMode = mode;
  }, [mode]);
}
