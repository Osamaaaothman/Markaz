import { create } from "zustand";

export type Locale = "en" | "ar";

interface UiState {
  locale: Locale;
  sidebarCollapsed: boolean;
  setLocale: (locale: Locale) => void;
  toggleSidebar: () => void;
}

// Client/UI state only (locale, layout, open panels). Server data is owned
// by TanStack Query, not duplicated here — see ADR in the wiki once written.
export const useUiStore = create<UiState>((set) => ({
  locale: "en",
  sidebarCollapsed: false,
  setLocale: (locale) => set({ locale }),
  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
}));
