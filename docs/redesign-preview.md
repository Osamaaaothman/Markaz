# Markaz redesign explorer

The original isolated design study is at `http://127.0.0.1:5186/redesign.html`.
All transactional actions there are simulations using fixtures.

Following the user's request to make all three directions selectable, the actual
application source now includes the topbar selector and Interface settings cards.
Review those actual components locally at `http://127.0.0.1:5186/appearance.html`.
That page renders the real shell, settings and component reference with disabled
queries and fixture cache data. It creates no authentication tokens and makes no
business changes. Neither HTML preview is included in the ordinary app build.
The implementation is local; it has not been deployed to production.

## Run and build

From the repository root in PowerShell:

```powershell
./scripts/preview-redesign.ps1
./scripts/preview-redesign.ps1 -Build
```

The dedicated Vite configuration is `apps/web/vite.redesign.config.ts`. It binds
only to loopback, has no API proxy, and builds into `output/redesign-preview`.
The regular ERP build does not include this entry. No new dependencies were added.
The build output must be served over HTTP; its entry is `redesign.html`.

## Directions

| Direction        | Geometry and composition                                                                                                              | Best fit                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Balance / اتّزان | 6px controls, 8px panels, anchored dark sidebar, connected KPI strip, underline tabs                                                  | General ERP workflows; recommended starting point          |
| Canvas / مساحة   | 12px fields, 18px panels, pill actions, floating light navigation, separate KPI cards and padded dialogs                              | Users who prefer spacious grouping and a calmer interface  |
| Precision / دقّة | 2px edges, icon navigation rail, horizontal module navigation, compact striped tables, inline dialog labels, row-style dialog catalog | Frequent users scanning dense financial and inventory data |

The fixed toolbar and each open dialog allow changing direction without losing
the current sample. All directions support Arabic/RTL and English/LTR, light/dark,
and comfortable/compact density. Motion uses 120/180/220ms transitions and obeys
both the preview toggle and `prefers-reduced-motion`. No decorative loops run.

## Recommendation

Keep PrimeReact 10 as the component engine and build a Markaz design system with
semantic tokens, shared components and domain patterns. Start with Balance unless
the user's review favors another direction. A framework migration would introduce
unnecessary interaction, accessibility and integration work for a visual redesign.

Use Carbon as guidance for dense tables, hierarchy and productive motion, not as
an additional component dependency:

- [PrimeReact 10 theming](https://v10.primereact.org/theming/)
- [Carbon data-table guidelines](https://www.carbondesignsystem.com/building-blocks/core/components/data-table/guidelines)
- [Carbon motion](https://www.carbondesignsystem.com/building-blocks/foundations/motion/overview)

## Coverage

Twelve review sections after the direction chooser cover:

1. Dashboard shell, metrics, comparison chart and attention queue.
2. Primary/secondary/text/danger actions, sizes, loading, disabled, icon actions,
   tooltip, action popover and copy ID.
3. Text, number, currency, date, searchable select, multi-select, textarea,
   password, radio, checkbox, switch, validation, read-only, disabled and statuses.
4. Search, filter tabs, sorting, pagination, checkbox selection, bulk CSV export,
   column visibility and a row-specific detail drawer.
5. Invoice header, editable lines, integer minor-unit totals, VAT, draft feedback,
   print preview and posting review.
6. Account tree, balance details, journal, allocation, income statement and balance sheet.
7. Breadcrumbs, tabs, steps, accordion, avatars, login form and account card.
8. The searchable dialog catalog (source mapping in `catalog.ts`).
9. Toasts, inline messages, empty, loading, offline, permission and progress states.
10. Local file selection, drop target, file list, image preview, audit and document trail.
11. Type, semantic palette, geometry and motion demonstration.
12. Recommendation, browser-local preference and downloadable feedback.

The catalog maps the existing dialog families to redesigned fixture presentations;
shared create/edit structures are combined. It also includes a proposed quick-view
drawer and posting review. Field subsets demonstrate layout and interaction, not a
replacement implementation of production forms or their full business validation.

Actual PrimeReact controls include Avatar, Button, Calendar, Checkbox, DataTable,
Column, Dialog, Dropdown, Image, InputNumber, InputSwitch, InputText, InputTextarea,
Message, MultiSelect, OverlayPanel, Password, SelectButton, Skeleton, TabView, Tag,
Toast, Tooltip and TreeTable. Composed previews cover the shared grid, import,
created-result, draft, attachment, permission, money, line-field and audit patterns.

## Data and persistence

- The preview imports no app authentication, API client or business hooks.
- File selection records names and sizes locally; it uploads nothing.
- CSV export downloads the filtered or selected sample rows.
- The invoice editor uses bounded whole-number quantities and integer minor-unit
  prices, with VAT rounded to the nearest minor unit. It is a layout demonstration,
  not the ERP's production accounting implementation.
- Review preferences use only `markaz-redesign-review-v1` in this browser's
  localStorage. A blocked storage write falls back to the current session.
- The URL `?style=balance`, `?style=canvas` or `?style=precision` selects a direction.

## Validation

Completed on 2026-11-15:

- The full web TypeScript check and the dedicated production build passed.
- All 47 catalog dialogs opened and closed. Fifteen distinct dialog patterns were
  checked again against the final static build; no browser errors or warnings were
  recorded during that final review.
- Table search, status filtering, detail drawers, role selection, import steps,
  required confirmation reasons and Escape-to-close were exercised.
- Changing an invoice quantity updated its total from 3,507.50 to 4,025.00.
  The posting review retained that total and the chosen customer and warehouse.
- Arabic/RTL, English/LTR, light/dark and all three design directions were checked.
  At 390px mobile and 1440px desktop viewport widths, the checked layouts had no
  document-level horizontal overflow. Mobile dialogs also fit their viewport.
- Desktop screenshots are saved in `output/redesign-qa/`.

Browser checks use local fixtures and responsive desktop emulation, not real
devices or production data. The final local review server serves the built preview
at port 5186; its browser tab is retained for the user's review.

The subsequent appearance-switcher checks passed: four storage/mode compatibility
tests, web TypeScript, i18n key parity, the application build and the dual-entry
preview build. Browser checks covered all three field geometries (6/12/2px), dialog
geometries (8/18/2px), persistence after reload, and preservation of edited field
text when switching. Mobile checks at 390px covered all three layouts, English,
dark mode and mobile navigation. No browser errors or warnings were recorded.
Screenshot: `output/redesign-qa/appearance-switcher.png`.

Production rollout remains a separate task.

Colour/layout refinement: the application now stores style and palette separately.
All 15 palettes (including the six original direction colours) are available on
any style; switching either preserves the other. Seven focused tests cover the
combinations, reload, mode toggles and migration from existing preferences.
Both preview toolbar selectors now use the shared themed `ChoiceSelect` popup;
there are no authored native `<select>` elements remaining in the web source.
The final browser review confirmed independent Canvas/Precision colour mixing,
retained field input, reload persistence, styled popup selection with keyboard
navigation, the dark popup at a 390px viewport, and the original explorer's popup.
The final TypeScript, locale parity and both builds passed. Screenshot:
`output/redesign-qa/appearance-colours-dropdown.png`.
