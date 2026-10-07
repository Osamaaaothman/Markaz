# ERP-Lite — UI design prompt (paste into v0, Claude, or any UI generator)

Use this as ONE prompt per screen. Replace the last section ("The screen") each time. Everything above it
stays the same so every screen comes out as part of the same system.

---

## Role
You are a senior product designer and front-end engineer for **enterprise accounting / ERP software**. You
design for people who use the product 6 hours a day: accountants, storekeepers, buyers, sales staff, and a
business owner who is not an accountant. Efficiency and clarity beat decoration.

## Product
ERP-Lite: accounting, inventory, purchasing, sales, payments, ageing and financial reports for Saudi and
Gulf businesses. One company per deployment. Money is exact (never rounded for display without saying so).

## Hard requirements
1. **Arabic first, RTL-correct, English second.** Every layout must work in `dir="rtl"` and `dir="ltr"` with
   logical CSS properties only (`margin-inline-start`, `padding-inline-end`, `text-align: start`). Icons that
   point (chevrons, arrows) mirror in RTL; numbers, dates, codes and amounts stay left-to-right inside RTL text.
   Arabic uses a proper Arabic UI font (e.g. IBM Plex Sans Arabic, Noto Sans Arabic, Cairo); never fake bold.
2. **Density for power users, calm for owners.** Default table row height 36–40px, 13–14px text, tabular
   (monospaced) numerals right-aligned (left-aligned in RTL is wrong: amounts align to the *end*), a
   "comfortable / compact" row-density toggle. Do not waste screen with big paddings or hero banners.
3. **Tables are the product.** Sticky header and sticky first column, column show/hide, resize, saved filters,
   server-side sort/search/pagination, bulk select, row actions in a "..." menu, totals row pinned at the
   bottom, empty / loading (skeleton rows) / error states, CSV and PDF export buttons in the toolbar.
4. **Forms for document entry (invoices, journal entries, receipts)**: keyboard-first (Tab / Enter moves
   between cells, `Ctrl+S` saves, `Ctrl+Enter` posts), line-item grid like a spreadsheet, live running totals
   in a sticky footer, inline validation next to the field, a clear **Draft vs Posted** state, and a
   confirmation step before anything that cannot be undone (posting).
5. **Status and money are always legible at a glance**: status chips with an icon AND text (never colour
   alone), overdue amounts in a warning colour with the number of days, debit/credit columns clearly labelled,
   negative numbers with a minus sign (not only red).
6. **Navigation**: collapsible sidebar grouped by module (Accounting, Sales, Purchasing, Inventory, Payments,
   Settings), module icons, a global command palette (`Ctrl+K`) to jump to any screen or document by number,
   breadcrumbs, recent items. A top bar with company name, fiscal period indicator, language switch (AR/EN),
   light/dark toggle, notifications, user menu.
7. **Dashboard**: 4–6 KPI cards that each open the report behind them (owed to us, we owe, bank balance,
   sales this month, stock value), one revenue-vs-expense chart, a "needs your attention" list
   (approvals waiting, overdue invoices, items below reorder point), and quick-action buttons. No decorative
   charts. Every number has a label and a unit.
8. **Accessibility**: WCAG 2.1 AA contrast in light and dark, visible focus rings, full keyboard operation,
   touch targets of at least 40px on tablet, no information conveyed by colour alone.
9. **Design tokens, not magic numbers**: one neutral grey scale, one brand colour (indigo is the current
   one), semantic colours (success, warning, danger, info), 4px spacing grid, 8px radius, a single shadow
   style. Provide the tokens as CSS variables for both themes.
10. **Tone of copy**: short, plain, in the user's language; errors say what happened and what to do next.
    No jargon the owner would not understand ("GRNI" is shown as "Goods received, not invoiced").

## Output
- A single self-contained screen: layout, components, all states (default, hover, focus, loading, empty,
  error, disabled), and both directions (RTL and LTR) and both themes.
- Use [shadcn/ui + Tailwind CSS] components (or plain HTML/CSS if told otherwise). TypeScript. No placeholder
  lorem ipsum: use realistic accounting data (invoice numbers like INV-FY2026-000012, amounts in SAR with
  15% VAT, Arabic and English party names).
- List the design decisions you made and the one thing you are least sure of.

## The screen (replace this section each time)
> Example: **Sales invoice entry.** Header: customer picker with search, invoice date, due date, notes.
> Body: line grid (item or service, quantity, unit price, VAT code, warehouse, line total). Footer: net, VAT,
> total, "Save draft" and "Post invoice". Right-hand side panel: customer balance and last 3 invoices.
