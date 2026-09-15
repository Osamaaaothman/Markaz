import { useTranslation } from "react-i18next";
import { NavLink } from "react-router-dom";
import { cn } from "../../shared/ui/cn";
import { NAV_ITEMS } from "./NavConfig";
import { useLayoutStore } from "./layout-store";

export interface SidebarProps {
  readonly variant: "desktop" | "mobile-drawer";
}

// Independent dark "rail" palette (--sidebar-*, see tokens.css) — always dark
// regardless of the app's own light/dark mode, per GWEB-UI-DESIGN-SYSTEM.md §5.7.
export function Sidebar({ variant }: SidebarProps): React.JSX.Element {
  const { t } = useTranslation();
  const closeMobileSidebar = useLayoutStore((state) => state.closeMobileSidebar);

  return (
    <nav
      className="flex h-full flex-col gap-1 bg-sidebar px-3 py-5 text-sidebar-foreground"
      aria-label={t("app.name")}
    >
      <div className="mb-6 flex items-center gap-3 px-2">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary font-serif text-base font-medium text-sidebar-primary-foreground">
          م
        </span>
        <div className="flex flex-col leading-tight">
          <span className="font-serif text-base font-medium">{t("app.name")}</span>
          <span className="text-xs text-sidebar-foreground/60">{t("app.tagline")}</span>
        </div>
      </div>
      <ul className="flex flex-1 flex-col gap-0.5">
        {NAV_ITEMS.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              end={item.to === "/"}
              onClick={variant === "mobile-drawer" ? closeMobileSidebar : undefined}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                  isActive
                    ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                )
              }
            >
              <item.icon className="size-4 shrink-0" aria-hidden="true" />
              <span>{t(item.labelKey)}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
