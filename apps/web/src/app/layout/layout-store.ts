import { create } from "zustand";
import { persist } from "zustand/middleware";

// Local UI state only (docs/08-FRONTEND-I18N-RULES.md §2). The mobile drawer and the command palette
// always start closed; the collapsed sidebar and which sidebar sections are folded
// are the user's own preferences, so they are remembered on this device.
interface LayoutState {
  mobileSidebarOpen: boolean;
  openMobileSidebar: () => void;
  closeMobileSidebar: () => void;
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  // Sidebar group headings (NavItem.groupKey) the user folded closed. Absent = expanded (the default).
  collapsedGroups: Record<string, boolean>;
  toggleGroup: (groupKey: string) => void;
  // Sidebar section order as the user rearranged it. Empty = NavConfig's built-in order (the default).
  // A group added later with no saved position falls back to that built-in order too (see Sidebar.tsx).
  groupOrder: string[];
  setGroupOrder: (order: string[]) => void;
  resetGroupOrder: () => void;
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
      collapsedGroups: {},
      toggleGroup: (groupKey) => set({ collapsedGroups: { ...get().collapsedGroups, [groupKey]: !get().collapsedGroups[groupKey] } }),
      groupOrder: [],
      setGroupOrder: (order) => set({ groupOrder: order }),
      resetGroupOrder: () => set({ groupOrder: [] }),
      paletteOpen: false,
      openPalette: () => set({ paletteOpen: true }),
      closePalette: () => set({ paletteOpen: false }),
    }),
    {
      name: "erp-layout",
      partialize: (state) => ({
        sidebarCollapsed: state.sidebarCollapsed,
        collapsedGroups: state.collapsedGroups,
        groupOrder: state.groupOrder,
      }),
    },
  ),
);
