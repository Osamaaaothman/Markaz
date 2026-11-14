import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";
import { usePermissions } from "../../shared/auth/use-permissions";
import { useThemeStore } from "../../shared/theme/theme-store";
import { useLayoutStore } from "./layout-store";
import { NAV_ITEMS, GROUP_ICONS, DEFAULT_GROUP_ICON, sortGroups } from "./NavConfig";

export function ModuleNavigation(): React.JSX.Element | null {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const { canAny } = usePermissions();
  const groupOrder = useLayoutStore((state) => state.groupOrder);
  const precision = useThemeStore((state) => state.direction === "precision");
  if (!precision) return null;
  const items = NAV_ITEMS.filter((item) => canAny(item.permissions ?? []));
  const groups = sortGroups(
    [...new Set(items.flatMap((item) => (item.groupKey ? [item.groupKey] : [])))],
    groupOrder,
  );
  const current = [...items]
    .filter((item) =>
      item.to === "/"
        ? pathname === "/"
        : pathname === item.to || pathname.startsWith(`${item.to}/`),
    )
    .sort((a, b) => b.to.length - a.to.length)[0];
  return (
    <nav className="mk-module-nav" aria-label={t("interfaceSettings.moduleNavigation")}>
      {groups.map((key) => {
        const target = items.find((item) => item.groupKey === key)!;
        return (
          <Link
            key={key}
            to={target.to}
            aria-current={current?.groupKey === key ? "true" : undefined}
          >
            <i className={GROUP_ICONS[key] ?? DEFAULT_GROUP_ICON} aria-hidden="true" />
            {t(key)}
          </Link>
        );
      })}
    </nav>
  );
}
