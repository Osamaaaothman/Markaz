import { create } from "zustand";

// Local UI state only (docs/08-FRONTEND-I18N-RULES.md §2) — whether the sidebar
// drawer is open on a narrow viewport. Not persisted: it should always start
// closed on a fresh mobile page load.
interface LayoutState {
  mobileSidebarOpen: boolean;
  openMobileSidebar: () => void;
  closeMobileSidebar: () => void;
}

export const useLayoutStore = create<LayoutState>((set) => ({
  mobileSidebarOpen: false,
  openMobileSidebar: () => set({ mobileSidebarOpen: true }),
  closeMobileSidebar: () => set({ mobileSidebarOpen: false }),
}));
