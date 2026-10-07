import { useTranslation } from "react-i18next";
import { NavLink } from "react-router-dom";
import { Tooltip } from "primereact/tooltip";
import { usePermissions } from "../../shared/auth/use-permissions";
import { useCurrentUser } from "../../shared/auth/use-current-user";
import { useApiImageUrl } from "../../shared/ui/ApiImage";
import { Logo } from "../../shared/ui/Logo";
import { NAV_ITEMS } from "./NavConfig";
import { useLayoutStore } from "./layout-store";

export interface SidebarProps {
  readonly variant: "desktop" | "mobile-drawer";
}

// The dark navigation rail. Entries the user has no permission for are not drawn at all; a group heading
// appears only where the group changes, so an empty group never shows one. Collapsed to icons it keeps
// every label as a tooltip, so nothing becomes unreachable; expanded, the tooltip shows long labels in full.
export function Sidebar({ variant }: SidebarProps): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const closeMobileSidebar = useLayoutStore((state) => state.closeMobileSidebar);
  const collapsedPref = useLayoutStore((state) => state.sidebarCollapsed);
  const toggleSidebar = useLayoutStore((state) => state.toggleSidebar);
  const { data: currentUser } = useCurrentUser();
  const { canAny } = usePermissions();
  const { url: companyLogo } = useApiImageUrl("/v1/company/logo", "current");
  const collapsed = variant === "desktop" && collapsedPref;
  const visibleItems = NAV_ITEMS.filter((item) => canAny(item.permissions ?? []));

  return (
    <nav className={`erp-sidebar erp-sidebar--${variant}${collapsed ? " erp-sidebar--collapsed" : ""}`} aria-label={t("app.name")}>
      <div className="erp-sidebar__brand">
        <Logo variant="full" size={collapsed ? 40 : 42} name={t("app.name")} tagline={t("app.tagline")} className="erp-sidebar__logo" />
      </div>

      {variant === "desktop" ? (
        <Tooltip target=".erp-sidebar--desktop [data-pr-tooltip]" position={i18n.dir() === "rtl" ? "left" : "right"} showDelay={collapsed ? 150 : 700} />
      ) : null}

      <ul className="erp-sidebar__nav">
        {visibleItems.map((item, index) => (
          <li key={item.to} className="erp-sidebar__item">
            {item.groupKey && item.groupKey !== visibleItems[index - 1]?.groupKey ? (
              <span className="erp-sidebar__group">{t(item.groupKey)}</span>
            ) : null}
            <NavLink
              to={item.to}
              end={item.to === "/"}
              data-pr-tooltip={t(item.labelKey)}
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
          <div className="erp-sidebar__company" data-pr-tooltip={`${currentUser.companyName} · ${currentUser.companyDefaultCurrency}`}>
            {companyLogo ? <img className="erp-sidebar__company-logo" src={companyLogo} alt="" /> : <span className="erp-sidebar__company-dot" aria-hidden="true" />}
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
            data-pr-tooltip={collapsed ? t("shell.expandSidebar") : t("shell.collapseSidebar")}
          >
            <i className="pi pi-angle-double-left" aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </nav>
  );
}
