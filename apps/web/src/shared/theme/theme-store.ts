import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ThemeMode = "light" | "dark";

// Each theme is a full palette (design/themes.css, keyed by html[data-theme]). `mode` picks which
// PrimeReact base stylesheet it sits on. The choice is local to this browser; nothing is sent to the server.
export const THEMES = [
  { id: "forest", mode: "light" },
  { id: "classic", mode: "light" },
  { id: "ocean", mode: "light" },
  { id: "sand", mode: "light" },
  { id: "plum", mode: "light" },
  { id: "night", mode: "dark" },
  { id: "graphite", mode: "dark" },
  { id: "prime", mode: "light" },
  { id: "primedark", mode: "dark" },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];

export function modeOf(theme: ThemeId): ThemeMode {
  return THEMES.find((entry) => entry.id === theme)?.mode ?? "light";
}

interface ThemeState {
  theme: ThemeId;
  // The last theme picked in each mode, so the quick light/dark toggle returns to what the user chose.
  lastLight: ThemeId;
  lastDark: ThemeId;
  mode: ThemeMode;
  setTheme: (theme: ThemeId) => void;
  toggle: () => void;
}

function pick(theme: ThemeId, state: Pick<ThemeState, "lastLight" | "lastDark">): Pick<ThemeState, "theme" | "mode" | "lastLight" | "lastDark"> {
  const mode = modeOf(theme);
  return { theme, mode, lastLight: mode === "light" ? theme : state.lastLight, lastDark: mode === "dark" ? theme : state.lastDark };
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: "forest",
      lastLight: "forest",
      lastDark: "night",
      mode: "light",
      setTheme: (theme) => set(pick(theme, get())),
      toggle: () => {
        const { mode, lastLight, lastDark } = get();
        set(pick(mode === "dark" ? lastLight : lastDark, get()));
      },
    }),
    {
      name: "erp-theme",
      version: 2,
      partialize: (state) => ({ theme: state.theme, lastLight: state.lastLight, lastDark: state.lastDark }),
      // Version 1 stored only { mode }.
      migrate: (stored) => {
        const old = stored as { mode?: ThemeMode } | undefined;
        const theme: ThemeId = old?.mode === "dark" ? "night" : "forest";
        const lastLight: ThemeId = "forest";
        const lastDark: ThemeId = "night";
        return { theme, lastLight, lastDark };
      },
      merge: (persisted, current) => {
        const saved = persisted as Partial<Pick<ThemeState, "theme" | "lastLight" | "lastDark">> | undefined;
        const theme = THEMES.some((entry) => entry.id === saved?.theme) ? (saved?.theme as ThemeId) : current.theme;
        return { ...current, ...saved, theme, mode: modeOf(theme) };
      },
    },
  ),
);
