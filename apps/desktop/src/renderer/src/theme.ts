import { createTheme } from "@mantine/core";

// Single customized theme used everywhere in the app — this is what keeps
// dialogs/forms/toasts looking like one deliberate product instead of
// ad-hoc per-screen styling.
export const theme = createTheme({
  primaryColor: "brand",
  colors: {
    brand: [
      "#eef3ff",
      "#dce4f5",
      "#b9c7e6",
      "#93a8d8",
      "#728dcc",
      "#5c7ac5",
      "#4f71c3",
      "#3f60ac",
      "#35559b",
      "#26478a",
    ],
  },
  defaultRadius: "md",
  fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif",
});
