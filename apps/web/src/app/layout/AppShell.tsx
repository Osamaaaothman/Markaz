import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Outlet } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { cn } from "../../shared/ui/cn";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { useLayoutStore } from "./layout-store";

// The `lg:` breakpoint is the single source of truth for "desktop sidebar
// shown" — both the sidebar column below and Topbar's hamburger button key
// off the same Tailwind breakpoint, so unlike the old CSS (two independent
// hand-written @media blocks that could drift out of sync — see the git
// history of app.css for the bug that caused), there is no way for them to
// disagree.
//
// The mobile drawer animates via Radix's own data-state open/closed classes
// (tw-animate-css), not Framer Motion — nesting Framer's AnimatePresence
// inside Radix's Portal/Presence tree breaks ref forwarding (Radix expects to
// attach its own ref to the immediate child for exit-animation timing), so
// this drawer intentionally does not use `motion` even though other
// enter/exit UI in the app does.
export function AppShell(): React.JSX.Element {
  const { i18n, t } = useTranslation();
  const mobileSidebarOpen = useLayoutStore((state) => state.mobileSidebarOpen);
  const openMobileSidebar = useLayoutStore((state) => state.openMobileSidebar);
  const closeMobileSidebar = useLayoutStore((state) => state.closeMobileSidebar);
  const isRtl = i18n.dir() === "rtl";

  return (
    <div className="flex min-h-screen bg-background">
      <div className="hidden w-68 shrink-0 border-e border-border lg:block">
        <Sidebar variant="desktop" />
      </div>

      <DialogPrimitive.Root
        open={mobileSidebarOpen}
        onOpenChange={(open) => {
          if (!open) closeMobileSidebar();
          else openMobileSidebar();
        }}
      >
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <DialogPrimitive.Content
            className={cn(
              "fixed inset-y-0 start-0 z-50 w-68 max-w-[82vw] shadow-lg outline-none",
              "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:duration-200 data-[state=open]:duration-200",
              isRtl
                ? "data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right"
                : "data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left",
            )}
          >
            <DialogPrimitive.Title className="sr-only">{t("app.name")}</DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">{t("app.tagline")}</DialogPrimitive.Description>
            <Sidebar variant="mobile-drawer" />
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
