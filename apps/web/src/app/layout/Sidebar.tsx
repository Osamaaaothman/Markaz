import { useTranslation } from "react-i18next";
import { NavLink } from "react-router-dom";
import { usePermissions } from "../../shared/auth/use-permissions";
import { useCurrentUser } from "../../shared/auth/use-current-user";
import { Logo } from "../../shared/ui/Logo";
import { NAV_ITEMS } from "./NavConfig";
import { useLayoutStore } from "./layout-store";

export interface SidebarProps {
  readonly variant: "desktop" | "mobile-drawer";
}

// The dark navigation rail. Entries the user has no permission for are not drawn at all; a group heading
// appears only where the group changes, so an empty group never shows one. Collapsed to icons it keeps
// every label as a tooltip, so nothing becomes unreachable.
export function Sidebar({ variant }: SidebarProps): React.JSX.Element {
  const { t } = useTranslation();
  const closeMobileSidebar = useLayoutStore((state) => state.closeMobileSidebar);
  const collapsedPref = useLayoutStore((state) => state.sidebarCollapsed);
  const toggleSidebar = useLayoutStore((state) => state.toggleSidebar);
  const { data: currentUser } = useCurrentUser();
  const { canAny } = usePermissions();
  const collapsed = variant === "desktop" && collapsedPref;
  const visibleItems = NAV_ITEMS.filter((item) => canAny(item.permissions ?? []));

  return (
    <nav className={`erp-sidebar erp-sidebar--${variant}${collapsed ? " erp-sidebar--collapsed" : ""}`} aria-label={t("app.name")}>
      <div className="erp-sidebar__brand">
        <Logo variant="full" size={collapsed ? 40 : 42} name={t("app.name")} tagline={t("app.tagline")} className="erp-sidebar__logo" />
      </div>

      <ul className="erp-sidebar__nav">
        {visibleItems.map((item, index) => (
          <li key={item.to} className="erp-sidebar__item">
            {item.groupKey && item.groupKey !== visibleItems[index - 1]?.groupKey ? (
              <span className="erp-sidebar__group">{t(item.groupKey)}</span>
            ) : null}
            <NavLink
              to={item.to}
              end={item.to === "/"}
              title={collapsed ? t(item.labelKey) : undefined}
              className={({ isActive }) => `erp-sidebar__link${isActive ? " erp-sidebar__link--active" : ""}`}
              onClick={variant === "mobile-drawer" ? closeMobileSidebar : undefined}
            >
              <i className={item.icon} aria-hidden="true" />
              <span className="erp-sidebar__label">{t(item.labelKey)}</span>
            </NavLink>
          </li>
        ))}
      </ul>

      <div className="erp-sidebar__footer">
        {currentUser ? (
          <div className="erp-sidebar__company" title={currentUser.companyName}>
            <span className="erp-sidebar__company-dot" aria-hidden="true" />
            <span className="erp-sidebar__label">
              <strong>{currentUser.companyName}</strong>
              <small>{currentUser.companyDefaultCurrency}</small>
            </span>
          </div>
        ) : null}
        {variant === "desktop" ? (
          <button
            type="button"
            className="erp-sidebar__collapse"
            onClick={toggleSidebar}
            aria-label={collapsed ? t("shell.expandSidebar") : t("shell.collapseSidebar")}
            title={collapsed ? t("shell.expandSidebar") : t("shell.collapseSidebar")}
          >
            <i className="pi pi-angle-double-left" aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </nav>
  );
}
