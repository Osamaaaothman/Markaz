import { useEffect } from "react";
import { Outlet } from "react-router-dom";
import { CommandPalette } from "./CommandPalette";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { useLayoutStore } from "./layout-store";
import { useLineGridKeys } from "./use-line-grid-keys";

// docs/08-FRONTEND-I18N-RULES.md §4/§9: the desktop sidebar is a permanent column; below the responsive
// breakpoint it becomes a slide-in drawer (the stylesheet handles the breakpoint and uses logical
// properties, so it flips correctly under RTL without any JS).
export function AppShell(): React.JSX.Element {
  const mobileSidebarOpen = useLayoutStore((state) => state.mobileSidebarOpen);
  const closeMobileSidebar = useLayoutStore((state) => state.closeMobileSidebar);
  const collapsed = useLayoutStore((state) => state.sidebarCollapsed);
  const density = useLayoutStore((state) => state.density);

  // Density is a document-level setting: every table, field and button reads it from the root.
  useEffect(() => {
    document.documentElement.dataset.density = density;
  }, [density]);

  useLineGridKeys();

  return (
    <div className={`erp-shell${collapsed ? " erp-shell--collapsed" : ""}`}>
      <div className="erp-shell__desktop-sidebar">
        <Sidebar variant="desktop" />
      </div>

      {mobileSidebarOpen ? (
        <div className="erp-shell__mobile-overlay" onClick={closeMobileSidebar} role="presentation">
          <div className="erp-shell__mobile-drawer" onClick={(e) => e.stopPropagation()}>
            <Sidebar variant="mobile-drawer" />
          </div>
        </div>
      ) : null}

      <div className="erp-shell__main">
        <Topbar />
        <main className="erp-shell__content">
          <Outlet />
        </main>
      </div>
      <CommandPalette />
    </div>
  );
}
