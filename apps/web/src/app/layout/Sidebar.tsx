import { useTranslation } from "react-i18next";
import { NavLink } from "react-router-dom";
import { NAV_ITEMS } from "./NavConfig";
import { useLayoutStore } from "./layout-store";

export interface SidebarProps {
  readonly variant: "desktop" | "mobile-drawer";
}

export function Sidebar({ variant }: SidebarProps): React.JSX.Element {
  const { t } = useTranslation();
  const closeMobileSidebar = useLayoutStore((state) => state.closeMobileSidebar);

  return (
    <nav className={`erp-sidebar erp-sidebar--${variant}`} aria-label={t("app.name")}>
      <div className="erp-sidebar__brand">
        <span className="erp-sidebar__brand-mark">م</span>
        <div className="erp-sidebar__brand-text">
          <span className="erp-sidebar__brand-name">{t("app.name")}</span>
          <span className="erp-sidebar__brand-tagline">{t("app.tagline")}</span>
        </div>
      </div>
      <ul className="erp-sidebar__nav">
        {NAV_ITEMS.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) => `erp-sidebar__link${isActive ? " erp-sidebar__link--active" : ""}`}
              onClick={variant === "mobile-drawer" ? closeMobileSidebar : undefined}
            >
              <i className={item.icon} aria-hidden="true" />
              <span>{t(item.labelKey)}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
