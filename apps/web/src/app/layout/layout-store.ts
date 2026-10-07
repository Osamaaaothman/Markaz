import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Density = "comfortable" | "compact";

// Local UI state only (docs/08-FRONTEND-I18N-RULES.md §2). The mobile drawer and the command palette
// always start closed; the collapsed sidebar and the row density are the user's own preferences, so
// they are remembered on this device.
interface LayoutState {
  mobileSidebarOpen: boolean;
  openMobileSidebar: () => void;
  closeMobileSidebar: () => void;
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  density: Density;
  toggleDensity: () => void;
  paletteOpen: boolean;
  openPalette: () => void;
  closePalette: () => void;
}

export const useLayoutStore = create<LayoutState>()(
  persist(
    (set, get) => ({
      mobileSidebarOpen: false,
      openMobileSidebar: () => set({ mobileSidebarOpen: true }),
      closeMobileSidebar: () => set({ mobileSidebarOpen: false }),
      sidebarCollapsed: false,
      toggleSidebar: () => set({ sidebarCollapsed: !get().sidebarCollapsed }),
      density: "comfortable",
      toggleDensity: () => set({ density: get().density === "comfortable" ? "compact" : "comfortable" }),
      paletteOpen: false,
      openPalette: () => set({ paletteOpen: true }),
      closePalette: () => set({ paletteOpen: false }),
    }),
    {
      name: "erp-layout",
      partialize: (state) => ({ sidebarCollapsed: state.sidebarCollapsed, density: state.density }),
    },
  ),
);
