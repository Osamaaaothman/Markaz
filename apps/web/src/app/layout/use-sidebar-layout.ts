import { useThemeStore } from "../../shared/theme/theme-store";
import { useLayoutStore } from "./layout-store";

// Precision starts with an icon rail, without overwriting the user's other layout.
// Its expand button remains available for users who prefer full navigation labels.
export function useSidebarLayout() {
  const precision = useThemeStore((state) => state.direction === "precision");
  const collapsed = useLayoutStore((state) =>
    precision ? !state.precisionSidebarExpanded : state.sidebarCollapsed,
  );
  const toggle = useLayoutStore((state) =>
    precision ? state.togglePrecisionSidebar : state.toggleSidebar,
  );
  return { collapsed, toggle };
}
