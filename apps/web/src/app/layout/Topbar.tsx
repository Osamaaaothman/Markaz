import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Avatar } from "primereact/avatar";
import { Menu } from "primereact/menu";
import type { MenuItem } from "primereact/menuitem";
import { useThemeStore } from "../../shared/theme/theme-store";
import { useAuthStore } from "../../shared/auth/auth-store";
import { useCurrentUser } from "../../shared/auth/use-current-user";
import { useLayoutStore } from "./layout-store";

function initialsOf(email: string): string {
  return email.slice(0, 2).toUpperCase();
}

export function Topbar(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const menuRef = useRef<Menu>(null);
  const mode = useThemeStore((state) => state.mode);
  const toggleTheme = useThemeStore((state) => state.toggle);
  const clearAuth = useAuthStore((state) => state.clear);
  const openMobileSidebar = useLayoutStore((state) => state.openMobileSidebar);
  const { data: currentUser } = useCurrentUser();

  const switchLanguage = (): void => {
    void i18n.changeLanguage(i18n.language === "ar" ? "en" : "ar");
  };

  const menuItems: MenuItem[] = [
    {
      label: currentUser?.email,
      disabled: true,
    },
    { separator: true },
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
      <button
        type="button"
        className="erp-topbar__icon-button erp-topbar__menu-toggle"
        onClick={openMobileSidebar}
        aria-label={t("nav.dashboard")}
      >
        <i className="pi pi-bars" />
      </button>

      <div className="erp-topbar__spacer" />

      <button
        type="button"
        className="erp-topbar__icon-button"
        onClick={switchLanguage}
        aria-label={t("language.switch")}
        title={t("language.switch")}
      >
        <i className="pi pi-language" />
      </button>

      <button
        type="button"
        className="erp-topbar__icon-button"
        onClick={toggleTheme}
        aria-label={mode === "dark" ? t("theme.switchToLight") : t("theme.switchToDark")}
        title={mode === "dark" ? t("theme.switchToLight") : t("theme.switchToDark")}
      >
        <i className={mode === "dark" ? "pi pi-sun" : "pi pi-moon"} />
      </button>

      <button
        type="button"
        className="erp-topbar__avatar-button"
        onClick={(e) => menuRef.current?.toggle(e)}
        aria-label={currentUser?.email ?? ""}
      >
        <Avatar label={currentUser ? initialsOf(currentUser.email) : "…"} shape="circle" className="erp-topbar__avatar" />
      </button>
      {/* PrimeReact's popupAlignment only understands physical left/right, not a
          logical "end" — derived from the live direction so it still lands under
          the avatar (the inline-end side) in both languages. */}
      <Menu model={menuItems} popup ref={menuRef} popupAlignment={i18n.dir() === "rtl" ? "left" : "right"} />
    </header>
  );
}
