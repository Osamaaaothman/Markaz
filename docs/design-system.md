# Markaz design system

Live reference: the `/design-system` screen in the app (logo, colours, type, buttons, fields, tables, charts, motion).
This file explains the rules behind it. The stack stays **PrimeReact** — we restyle it, we do not replace it.

## Where things live

| Path | Purpose |
|---|---|
| `apps/web/src/design/tokens.css` | Every colour, radius, shadow, space, type size, density and motion value as a `--mk-*` variable. Light and dark are two token sets on `html[data-theme-mode]`. `--erp-*` names are legacy aliases. |
| `design/base.css` | Reset, fonts, focus ring, scrollbars, reduced motion. |
| `design/shell.css` | Sidebar, topbar, command palette, breadcrumbs, mobile drawer. |
| `design/components.css` | PrimeReact overrides (buttons, inputs, dropdowns, dialogs, tables, tabs, toasts) and `erp-*` building blocks. |
| `design/pages.css` | Login, dashboard, KPI cards, forms, line grids. |
| `design/motion.css` | Keyframes: stagger-in, chart growth, ring fill, logo draw-in. |
| `shared/ui/Logo.tsx` | The emblem (`mark`, `full`, `stacked`; `animate` once or `"loop"`). |
| `shared/ui/AnimatedMoney.tsx`, `shared/lib/use-count-up.ts` | Count-up figures. |
| `app/layout/CommandPalette.tsx` | `Ctrl+K` jump to any screen. |
| `app/layout/use-line-grid-keys.ts` | Excel-style keyboard movement in document line grids. |

## Rules

1. **Tokens only.** No hard-coded colour, radius or spacing in a component. Add a token first.
2. **Logical CSS only** (`margin-inline-start`, `inset-inline-end`, `text-align: start`). Never `left`/`right` — the product is RTL-first.
3. **PrimeReact overrides are physical-safe and specific.** The runtime theme `<link>` loads after our CSS, so overrides use `html body .p-…` or `html[data-theme-mode]` selectors to win on specificity, never `!important`.
4. **Numbers are tabular, money is exact.** Count-up animations end on the exact decimal string from the server; the animation is cosmetic and never rounds. Money is never a float.
5. **Charts are hand-drawn SVG**, no chart library. They draw left-to-right in both languages; labels around them follow the page direction.
6. **Motion is optional.** Every animation is disabled under `prefers-reduced-motion`. Duration tokens: fast 120 ms, base 220 ms, slow 480 ms.
7. **Density.** Comfortable (default) and compact, toggled in the topbar, stored per browser. Table row padding comes from `--mk-row-pad-*`.
8. **Every user-visible string is an i18n key** in both `en` and `ar` (parity is checked in the gate).
9. **Dark mode is a full token set**, not an inversion. Check both on every new screen.

## Palette (identity)

Ink `--mk-ink-*` (shell, hero), Forest `--mk-brand-*` (primary), Brass `--mk-brass-*` (centre dot, revenue/expense pairing). Flat colour only: no gradients, glows or decorative patterns. Semantic colours (`--mk-danger`, `--mk-warn`, `--mk-success`, `--mk-info`) are separate from the brand set.

## Logo

The Arabic letter meem (م) drawn as a ring with a tail, with a gold dot at its centre ("markaz" = centre). Ink tile, green stroke, brass dot. It never mirrors in RTL. Standalone favicon: `apps/web/public/favicon.svg` (keep in sync with `Logo.tsx`). The boot splash in `index.html` shows it until React mounts.

## Known gaps

- Column show/hide and a per-table toolbar are not built yet; tables have sticky headers, density and CSV/PDF export.
- The UI font is IBM Plex Sans Arabic (OFL), self-hosted through @fontsource, weights 400-700, Arabic and Latin subsets.
- Totals bars on document forms are inline with the form, not yet pinned; the actions bar is sticky.
