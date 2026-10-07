import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { Avatar } from "primereact/avatar";
import { Menu } from "primereact/menu";
import type { MenuItem } from "primereact/menuitem";
import { useThemeStore } from "../../shared/theme/theme-store";
import { useAuthStore } from "../../shared/auth/auth-store";
import { useCurrentUser } from "../../shared/auth/use-current-user";
import { NAV_ITEMS } from "./NavConfig";
import { useLayoutStore } from "./layout-store";
import { localizedName } from "../../shared/lib/localized-name";

function initialsOf(email: string): string {
  return email.slice(0, 2).toUpperCase();
}

// Which entry of the sidebar the current path belongs to: the longest matching prefix wins, so
// /sales/invoices/new is still "Sales invoices".
function currentNav(pathname: string): (typeof NAV_ITEMS)[number] | undefined {
  return [...NAV_ITEMS]
    .filter((item) => (item.to === "/" ? pathname === "/" : pathname === item.to || pathname.startsWith(`${item.to}/`)))
    .sort((a, b) => b.to.length - a.to.length)[0];
}

export function Topbar(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const menuRef = useRef<Menu>(null);
  const mode = useThemeStore((state) => state.mode);
  const toggleTheme = useThemeStore((state) => state.toggle);
  const clearAuth = useAuthStore((state) => state.clear);
  const openMobileSidebar = useLayoutStore((state) => state.openMobileSidebar);
  const openPalette = useLayoutStore((state) => state.openPalette);
  const density = useLayoutStore((state) => state.density);
  const toggleDensity = useLayoutStore((state) => state.toggleDensity);
  const { data: currentUser } = useCurrentUser();

  const nav = currentNav(pathname);
  const isArabic = i18n.language === "ar";
  const switchLanguage = (): void => {
    void i18n.changeLanguage(isArabic ? "en" : "ar");
  };

  const menuItems: MenuItem[] = [
    { template: () => (
        <div className="erp-usermenu__head">
          <strong>{currentUser?.email}</strong>
          <small>{currentUser ? localizedName({ name: currentUser.companyName, nameAr: currentUser.companyNameAr }, i18n.language) : null}</small>
        </div>
      ),
    },
    { separator: true },
    { label: t("shell.designSystem"), icon: "pi pi-palette", command: () => void navigate("/design-system") },
    {
      label: t("actions.logout"),
      icon: "pi pi-sign-out",
      command: () => {
        clearAuth();
        void navigate("/login", { replace: true });
      },
    },
  ];

  return (
    <header className="erp-topbar">
      <button type="button" className="erp-topbar__icon-button erp-topbar__menu-toggle" onClick={openMobileSidebar} aria-label={t("shell.openMenu")}>
        <i className="pi pi-bars" />
      </button>

      <nav className="erp-breadcrumb" aria-label={t("shell.breadcrumb")}>
        {nav?.groupKey ? (
          <>
            <span className="erp-breadcrumb__group">{t(nav.groupKey)}</span>
            <i className="pi pi-chevron-right erp-breadcrumb__sep" aria-hidden="true" />
          </>
        ) : null}
        <span className="erp-breadcrumb__page">{nav ? t(nav.labelKey) : t("app.name")}</span>
      </nav>

      <div className="erp-topbar__spacer" />

      <button type="button" className="erp-topbar__search" onClick={openPalette} aria-label={t("shell.search")}>
        <i className="pi pi-search" aria-hidden="true" />
        <span>{t("shell.search")}</span>
        <kbd>Ctrl K</kbd>
      </button>

      <button
        type="button"
        className="erp-topbar__icon-button"
        onClick={toggleDensity}
        aria-pressed={density === "compact"}
        aria-label={t("shell.density")}
        title={density === "compact" ? t("shell.densityCompact") : t("shell.densityComfortable")}
      >
        <i className={density === "compact" ? "pi pi-align-justify" : "pi pi-table"} />
      </button>

      <button type="button" className="erp-topbar__lang" onClick={switchLanguage} aria-label={t("language.switch")} title={t("language.switch")}>
        {isArabic ? "EN" : "عربي"}
      </button>

      <button
        type="button"
        className="erp-topbar__icon-button erp-topbar__theme"
        onClick={toggleTheme}
        aria-label={mode === "dark" ? t("theme.switchToLight") : t("theme.switchToDark")}
        title={mode === "dark" ? t("theme.switchToLight") : t("theme.switchToDark")}
      >
        <i className={mode === "dark" ? "pi pi-sun" : "pi pi-moon"} key={mode} />
      </button>

      <button type="button" className="erp-topbar__avatar-button" onClick={(e) => menuRef.current?.toggle(e)} aria-label={currentUser?.email ?? ""}>
        <Avatar label={currentUser ? initialsOf(currentUser.email) : "…"} shape="circle" className="erp-topbar__avatar" />
      </button>
      {/* PrimeReact's popupAlignment only understands physical left/right, not a logical "end". */}
      <Menu model={menuItems} popup ref={menuRef} popupAlignment={i18n.dir() === "rtl" ? "left" : "right"} className="erp-usermenu" />
    </header>
  );
}
