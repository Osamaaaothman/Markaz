import { Suspense, useLayoutEffect } from "react";
import { PageSkeleton } from "../../shared/ui/PageSkeleton";
import { Outlet, useLocation } from "react-router-dom";
import { InstallPrompt } from "../../shared/pwa/InstallPrompt";
import { OfflineBanner } from "../../shared/offline/OfflineBanner";
import { AssistantPanel } from "../../features/ai/AssistantPanel";
import { CommandPalette } from "./CommandPalette";
import { ExportProgress } from "./ExportProgress";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { useLayoutStore } from "./layout-store";
import { useLineGridKeys } from "./use-line-grid-keys";
import { useSidebarLayout } from "./use-sidebar-layout";

// docs/08-FRONTEND-I18N-RULES.md §4/§9: the desktop sidebar is a permanent column; below the responsive
// breakpoint it becomes a slide-in drawer (the stylesheet handles the breakpoint and uses logical
// properties, so it flips correctly under RTL without any JS).
export function AppShell(): React.JSX.Element {
  const mobileSidebarOpen = useLayoutStore((state) => state.mobileSidebarOpen);
  const closeMobileSidebar = useLayoutStore((state) => state.closeMobileSidebar);
  const { collapsed } = useSidebarLayout();
  const { key: locationKey } = useLocation();

  useLayoutEffect(() => {
    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    return () => { window.history.scrollRestoration = previous; };
  }, []);

  useLayoutEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [locationKey]);

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
        <OfflineBanner />
        <Topbar />
        <main className="erp-shell__content">
          <Suspense fallback={<PageSkeleton />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
      <CommandPalette />
      <AssistantPanel />
      <ExportProgress />
      <InstallPrompt />
    </div>
  );
}
