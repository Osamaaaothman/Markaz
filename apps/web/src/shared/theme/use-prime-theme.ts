import { useEffect } from "react";
import lightThemeUrl from "primereact/resources/themes/lara-light-indigo/theme.css?url";
import darkThemeUrl from "primereact/resources/themes/lara-dark-indigo/theme.css?url";
import { useThemeStore } from "./theme-store";

const LINK_ID = "prime-theme-link";

// TRANSITIONAL (frontend design-system migration, see
// GWEB-UI-DESIGN-SYSTEM.md-driven redesign): pages not yet migrated off
// PrimeReact's default styling still need the Lara stylesheet swap below to
// get any dark-mode support at all, so this keeps swapping it for now. Pages
// already migrated read the new Tailwind `.dark` class this hook now also
// toggles on <html>, which is the token system's actual switch (see
// tokens.css's `@custom-variant dark`). Once every PrimeReact usage is either
// migrated or moved to `unstyled`+`pt` styling (redesign's final cleanup
// phase), the Lara `<link>` swap goes away and only the `.dark` class remains.
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
    document.documentElement.classList.toggle("dark", mode === "dark");
  }, [mode]);
}
