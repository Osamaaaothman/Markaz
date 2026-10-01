import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { useLayoutStore } from "./layout-store";

// docs/08-FRONTEND-I18N-RULES.md §4/§9: the desktop sidebar is a permanent
// column; below the responsive breakpoint it becomes a slide-in drawer
// (erp.css handles the actual breakpoint + transform, so it can use a logical
// `inset-inline-start` that flips correctly under RTL without any JS).
export function AppShell(): React.JSX.Element {
  const mobileSidebarOpen = useLayoutStore((state) => state.mobileSidebarOpen);
  const closeMobileSidebar = useLayoutStore((state) => state.closeMobileSidebar);

  return (
    <div className="erp-shell">
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
    </div>
  );
}
