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
  { id: "balance", mode: "light" },
  { id: "balancedark", mode: "dark" },
  { id: "canvas", mode: "light" },
  { id: "canvasdark", mode: "dark" },
  { id: "precision", mode: "light" },
  { id: "precisiondark", mode: "dark" },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];

export const DESIGN_DIRECTIONS = [
  { id: "balance", light: "balance", dark: "balancedark" },
  { id: "canvas", light: "canvas", dark: "canvasdark" },
  { id: "precision", light: "precision", dark: "precisiondark" },
] as const satisfies readonly { id: string; light: ThemeId; dark: ThemeId }[];
export type DesignDirection = (typeof DESIGN_DIRECTIONS)[number]["id"];
export type DesignStyle = DesignDirection | "original";

function paletteDirectionOf(theme: ThemeId): DesignDirection | null {
  return (
    DESIGN_DIRECTIONS.find((entry) => entry.light === theme || entry.dark === theme)?.id ?? null
  );
}

export function modeOf(theme: ThemeId): ThemeMode {
  return THEMES.find((entry) => entry.id === theme)?.mode ?? "light";
}

interface ThemeState {
  theme: ThemeId;
  // Geometry and navigation are independent of the selected colour palette.
  direction: DesignStyle;
  // The last theme picked in each mode, so the quick light/dark toggle returns to what the user chose.
  lastLight: ThemeId;
  lastDark: ThemeId;
  mode: ThemeMode;
  setTheme: (theme: ThemeId) => void;
  setDirection: (direction: DesignStyle) => void;
  useDirectionPalette: () => void;
  toggle: () => void;
}

function pick(
  theme: ThemeId,
  state: Pick<ThemeState, "lastLight" | "lastDark">,
): Pick<ThemeState, "theme" | "mode" | "lastLight" | "lastDark"> {
  const mode = modeOf(theme);
  return {
    theme,
    mode,
    lastLight: mode === "light" ? theme : state.lastLight,
    lastDark: mode === "dark" ? theme : state.lastDark,
  };
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: "forest",
      direction: "original",
      lastLight: "forest",
      lastDark: "night",
      mode: "light",
      setTheme: (theme) => set(pick(theme, get())),
      setDirection: (direction) => set({ direction }),
      useDirectionPalette: () => {
        const { direction, mode } = get();
        const entry = DESIGN_DIRECTIONS.find((item) => item.id === direction);
        set(pick(entry ? entry[mode] : mode === "dark" ? "night" : "forest", get()));
      },
      toggle: () => {
        const { theme, mode, lastLight, lastDark } = get();
        const entry = DESIGN_DIRECTIONS.find((item) => item.id === paletteDirectionOf(theme));
        // Mode changes only the palette; the independent direction never changes.
        set(
          pick(
            entry
              ? entry[mode === "dark" ? "light" : "dark"]
              : mode === "dark"
                ? lastLight
                : lastDark,
            get(),
          ),
        );
      },
    }),
    {
      name: "erp-theme",
      version: 3,
      partialize: (state) => ({
        theme: state.theme,
        direction: state.direction,
        lastLight: state.lastLight,
        lastDark: state.lastDark,
      }),
      // V1 had only mode; v2 encoded the direction in the palette name.
      migrate: (
        stored,
        version,
      ): Pick<ThemeState, "theme" | "direction" | "lastLight" | "lastDark"> => {
        const old = stored as
          | (Partial<Pick<ThemeState, "theme" | "lastLight" | "lastDark">> & { mode?: ThemeMode })
          | undefined;
        if (version >= 2) {
          return {
            theme: old?.theme ?? "forest",
            lastLight: old?.lastLight ?? "forest",
            lastDark: old?.lastDark ?? "night",
            direction: old?.theme ? (paletteDirectionOf(old.theme) ?? "original") : "original",
          };
        }
        const theme: ThemeId = old?.mode === "dark" ? "night" : "forest";
        const lastLight: ThemeId = "forest";
        const lastDark: ThemeId = "night";
        return { theme, lastLight, lastDark, direction: "original" };
      },
      merge: (persisted, current) => {
        const saved = persisted as
          Partial<Pick<ThemeState, "theme" | "direction" | "lastLight" | "lastDark">> | undefined;
        const theme = THEMES.some((entry) => entry.id === saved?.theme)
          ? (saved?.theme as ThemeId)
          : current.theme;
        const lastLight = THEMES.some(
          (entry) => entry.id === saved?.lastLight && entry.mode === "light",
        )
          ? saved!.lastLight!
          : current.lastLight;
        const lastDark = THEMES.some(
          (entry) => entry.id === saved?.lastDark && entry.mode === "dark",
        )
          ? saved!.lastDark!
          : current.lastDark;
        const direction =
          saved?.direction === "original" ||
          DESIGN_DIRECTIONS.some((entry) => entry.id === saved?.direction)
            ? saved!.direction!
            : current.direction;
        return { ...current, theme, direction, lastLight, lastDark, mode: modeOf(theme) };
      },
    },
  ),
);
