import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { Avatar } from "primereact/avatar";
import { OverlayPanel } from "primereact/overlaypanel";
import { Tag } from "primereact/tag";
import { useThemeStore } from "../../shared/theme/theme-store";
import { useAuthStore } from "../../shared/auth/auth-store";
import { useCurrentUser } from "../../shared/auth/use-current-user";
import { NAV_ITEMS } from "./NavConfig";
import { useLayoutStore } from "./layout-store";
import { localizedName } from "../../shared/lib/localized-name";
import { groupPermissionsByResource } from "../../features/settings/permission-labels";

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
  const profileRef = useRef<OverlayPanel>(null);
  const mode = useThemeStore((state) => state.mode);
  const toggleTheme = useThemeStore((state) => state.toggle);
  const clearAuth = useAuthStore((state) => state.clear);
  const openMobileSidebar = useLayoutStore((state) => state.openMobileSidebar);
  const openPalette = useLayoutStore((state) => state.openPalette);
  const { data: currentUser } = useCurrentUser();

  const nav = currentNav(pathname);
  const isArabic = i18n.language === "ar";
  const switchLanguage = (): void => {
    void i18n.changeLanguage(isArabic ? "en" : "ar");
  };

  const logout = (): void => {
    clearAuth();
    void navigate("/login", { replace: true });
  };
  const email = currentUser?.email ?? "";
  const displayName = email.split("@")[0] ?? email;
  const permissionGroups = groupPermissionsByResource(currentUser?.permissions ?? []);
  const listFormat = new Intl.ListFormat(i18n.language, { style: "narrow", type: "conjunction" });

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

      <button type="button" className="erp-topbar__avatar-button" onClick={(e) => profileRef.current?.toggle(e)} aria-label={t("shell.profile")}>
        <Avatar label={currentUser ? initialsOf(email) : "…"} shape="circle" className="erp-topbar__avatar" />
      </button>
      <OverlayPanel ref={profileRef} className="erp-profile">
        <div className="erp-profile__head">
          <Avatar label={initialsOf(email)} shape="circle" size="large" className="erp-topbar__avatar" />
          <div className="erp-profile__id">
            <strong>{displayName}</strong>
            <span dir="ltr">{email}</span>
            <small>
              {currentUser ? localizedName({ name: currentUser.companyName, nameAr: currentUser.companyNameAr }, i18n.language) : null}
              {currentUser ? ` · ${currentUser.ref}` : null}
            </small>
          </div>
        </div>

        <h3 className="erp-profile__title">{t("shell.profileRole")}</h3>
        <div className="erp-profile__tags">
          {currentUser && currentUser.roles.length > 0 ? currentUser.roles.map((role) => <Tag key={role.id} value={role.name} />) : <small>{t("settings.usersRoles.noRoles")}</small>}
        </div>

        <h3 className="erp-profile__title">{t("shell.profileCanDo")}</h3>
        <ul className="erp-profile__perms">
          {permissionGroups.map((group) => (
            <li key={group.resource}>
              <span>{t(`settings.usersRoles.resources.${group.resource}`, group.resource)}</span>
              <small>{listFormat.format(group.actions.map((a) => t(`settings.usersRoles.actions.${a}`, a)))}</small>
            </li>
          ))}
        </ul>

        <div className="erp-profile__actions">
          <button type="button" className="erp-profile__action" onClick={() => void navigate("/settings/interface")}>
            <i className="pi pi-sliders-h" aria-hidden="true" />
            {t("nav.interface")}
          </button>
          <button type="button" className="erp-profile__action erp-profile__action--danger" onClick={logout}>
            <i className="pi pi-sign-out" aria-hidden="true" />
            {t("actions.logout")}
          </button>
        </div>
      </OverlayPanel>
    </header>
  );
}
