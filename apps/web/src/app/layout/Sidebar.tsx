import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { NavLink } from "react-router-dom";
import { Tooltip } from "primereact/tooltip";
import { usePermissions } from "../../shared/auth/use-permissions";
import { useCurrentUser } from "../../shared/auth/use-current-user";
import { useApiImageUrl } from "../../shared/ui/ApiImage";
import { localizedName } from "../../shared/lib/localized-name";
import { Logo } from "../../shared/ui/Logo";
import { DEFAULT_GROUP_ICON, GROUP_ICONS, NAV_ITEMS, sortGroups, type NavItem } from "./NavConfig";
import { usePurchasingCounts, type PurchasingCounts } from "../../features/purchasing/use-purchasing";
import { useLayoutStore } from "./layout-store";

// Ungrouped items keep NavConfig's order and stay first; grouped items are reordered by the user's
// saved section order (layout-store.groupOrder) while keeping each group's own items in place.
function orderByGroup(items: readonly NavItem[], groupOrder: readonly string[]): NavItem[] {
  const ungrouped = items.filter((item) => item.groupKey === undefined);
  const grouped = items.filter((item) => item.groupKey !== undefined);
  const groupKeysPresent = Array.from(new Set(grouped.map((item) => item.groupKey as string)));
  const orderedGroupKeys = sortGroups(groupKeysPresent, groupOrder);
  const itemsOf = (key: string): NavItem[] => grouped.filter((item) => item.groupKey === key);
  return [...ungrouped, ...orderedGroupKeys.flatMap(itemsOf)];
}

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
  const collapsedGroups = useLayoutStore((state) => state.collapsedGroups);
  const toggleGroup = useLayoutStore((state) => state.toggleGroup);
  const groupOrder = useLayoutStore((state) => state.groupOrder);
  const openPalette = useLayoutStore((state) => state.openPalette);
  const { data: currentUser } = useCurrentUser();
  const { canAny } = usePermissions();
  const { url: companyLogo } = useApiImageUrl("/v1/company/logo", "current");
  const collapsed = variant === "desktop" && collapsedPref;
  const permittedItems = NAV_ITEMS.filter((item) => canAny(item.permissions ?? []));
  const visibleItems = useMemo(() => orderByGroup(permittedItems, groupOrder), [permittedItems, groupOrder]);
  const { data: counts } = usePurchasingCounts();
  const badgeOf = (badge: "review" | "orders" | undefined): number => (badge ? badgeCount(badge, counts) : 0);

  return (
    <nav className={`erp-sidebar erp-sidebar--${variant}${collapsed ? " erp-sidebar--collapsed" : ""}`} aria-label={t("app.name")}>
      <div className="erp-sidebar__brand">
        <Logo variant="full" size={collapsed ? 44 : 48} name={t("app.name")} tagline={t("app.tagline")} className="erp-sidebar__logo" />
      </div>

      {variant === "desktop" ? (
        <Tooltip target=".erp-sidebar--desktop [data-pr-tooltip]" position={i18n.dir() === "rtl" ? "left" : "right"} showDelay={collapsed ? 150 : 700} />
      ) : null}

      <button
        type="button"
        className="erp-sidebar__search"
        onClick={() => {
          openPalette();
          if (variant === "mobile-drawer") closeMobileSidebar();
        }}
        data-pr-tooltip={t("shell.search")}
      >
        <i className="pi pi-search" aria-hidden="true" />
        <span className="erp-sidebar__label">{t("shell.search")}</span>
        <kbd className="erp-sidebar__kbd" aria-hidden="true">
          Ctrl K
        </kbd>
      </button>

      <ul className="erp-sidebar__nav">
        {visibleItems.map((item, index) => {
          const groupKey = item.groupKey;
          const groupStarts = groupKey !== undefined && groupKey !== visibleItems[index - 1]?.groupKey;
          const groupFolded = groupKey !== undefined && Boolean(collapsedGroups[groupKey]);
          return (
            <li key={item.to} className="erp-sidebar__item">
              {groupStarts ? (
                <button
                  type="button"
                  className="erp-sidebar__group"
                  onClick={() => toggleGroup(groupKey)}
                  aria-expanded={!groupFolded}
                  aria-label={t(groupFolded ? "shell.expandSection" : "shell.collapseSection", { section: t(groupKey) })}
                  data-pr-tooltip={t(groupKey)}
                >
                  <span className="erp-sidebar__group-title">
                    <i className={`${GROUP_ICONS[groupKey] ?? DEFAULT_GROUP_ICON} erp-sidebar__group-icon`} aria-hidden="true" />
                    <span className="erp-sidebar__group-text">{t(groupKey)}</span>
                  </span>
                  <i className={`pi pi-chevron-down erp-sidebar__group-chevron${groupFolded ? " erp-sidebar__group-chevron--folded" : ""}`} aria-hidden="true" />
                </button>
              ) : null}
              {groupFolded ? null : (
                <NavLink
                  to={item.to}
                  end={item.to === "/"}
                  data-pr-tooltip={t(item.labelKey)}
                  className={({ isActive }) => `erp-sidebar__link${isActive ? " erp-sidebar__link--active" : ""}`}
                  onClick={variant === "mobile-drawer" ? closeMobileSidebar : undefined}
                >
                  <span className="erp-sidebar__icon">
                    <i className={item.icon} aria-hidden="true" />
                  </span>
                  <span className="erp-sidebar__label">{t(item.labelKey)}</span>
                  {badgeOf(item.badge) > 0 ? (
                    <span className="erp-sidebar__badge" aria-label={t("shell.pendingCount", { count: badgeOf(item.badge) })}>
                      {badgeOf(item.badge) > 99 ? "99+" : badgeOf(item.badge)}
                    </span>
                  ) : null}
                </NavLink>
              )}
            </li>
          );
        })}
      </ul>

      <div className="erp-sidebar__footer">
        {currentUser ? (
          <div className="erp-sidebar__company" data-pr-tooltip={`${localizedName({ name: currentUser.companyName, nameAr: currentUser.companyNameAr }, i18n.language)} · ${currentUser.companyDefaultCurrency}`}>
            {companyLogo ? <img className="erp-sidebar__company-logo" src={companyLogo} alt="" /> : <span className="erp-sidebar__company-dot" aria-hidden="true" />}
            <span className="erp-sidebar__label">
              <strong>{localizedName({ name: currentUser.companyName, nameAr: currentUser.companyNameAr }, i18n.language)}</strong>
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

// Review = requests waiting for a decision. Orders = accepted requests still waiting for an order, plus orders waiting
// for approval. A part the user may not act on is absent from the counts and adds nothing.
function badgeCount(badge: "review" | "orders", counts: PurchasingCounts | undefined): number {
  if (!counts) return 0;
  return badge === "review" ? (counts.requestsToReview ?? 0) : (counts.requestsAccepted ?? 0) + (counts.ordersAwaitingApproval ?? 0);
}
