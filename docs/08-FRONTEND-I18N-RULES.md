# 08 — Frontend, i18n & RTL Rules

The product ships **Arabic and English, RTL and LTR, from day one**. A feature is not
done until both locales are complete and visually correct in both directions.

---

## 1. Structure

```
apps/web/src/
├── app/            router, providers, layout shell
├── features/       one folder per domain area, mirroring the backend modules
│   └── invoices/   components, hooks, api client, types, locales
├── shared/
│   ├── ui/         wrappers over PrimeReact — the rest of the app imports these
│   ├── lib/        money, dates, formatting, hijri
│   ├── api/        generated client + query setup
│   └── i18n/       i18next config, shared namespaces
└── locales/
    ├── ar/
    └── en/
```

- Feature folders do not import each other's internals — same boundary discipline as
  the backend.
- **Wrap PrimeReact components in `shared/ui`.** Never scatter raw PrimeReact props
  across 200 files; you will regret it the first time you need a global change.

---

## 2. State — the split is not optional

| Kind of state | Tool |
|---|---|
| Server data (everything from the API) | **TanStack Query** |
| Local UI state (modals, filters, wizard step, sidebar) | **Zustand** |
| Form state | **React Hook Form + Zod** |

Rules:
- **Server data never goes into Zustand.** Duplicating server state into a client store
  is how you get two versions of a customer's balance on one screen.
- Query keys always include the identifiers that scope the data.
- Mutations invalidate the queries they affect. Optimistic updates are allowed for
  trivial UI, **never for financial figures** — a user must not see a number that may
  be rolled back.
- Sensible `staleTime` per data kind: reference data long, ledger data short.

---

## 3. i18n — hard rules

1. **No hard-coded user-facing string, in any language, anywhere.** Not in a component,
   not in a toast, not in a validation message, not in a chart label, not in a PDF.
   Only translation keys.
2. Keys are namespaced and semantic: `invoices.actions.post`, not `label1`.
3. **`ar` and `en` are updated in the same commit.** A missing translation is a build
   failure, not a runtime fallback — add a CI check for key parity between locales.
4. Server error codes map to client translation keys. The server never sends display
   text.
5. Pluralisation and interpolation go through i18next — never string concatenation.
   Arabic has more plural forms than English; do not assume two.
6. Dates, numbers, and currency are formatted through **shared formatters** bound to
   locale + tenant settings — never `toLocaleString` scattered inline.

---

## 4. RTL — treat as a first-class layout, not a flag

- Direction is driven by locale: `<html dir="rtl" lang="ar">`.
- **Use logical CSS properties everywhere**: `margin-inline-start`, `padding-inline-end`,
  `inset-inline-start`, `text-align: start`. Never `margin-left` / `right:` for layout.
- Icons with direction meaning (arrows, chevrons, back/next, progress) must mirror.
  Icons without direction meaning (a printer, a user) must **not** mirror.
- Numbers, currency amounts, dates, and Latin identifiers stay **LTR inside RTL text** —
  use bidi isolation (`<bdi>` / `unicode-bidi: isolate`). A mis-bidi'd invoice number is
  a real, visible bug.
- Tables: column order mirrors; **numeric columns stay right-aligned in both
  directions** by accounting convention.
- Charts, PDFs, and email templates need RTL treatment too — they are the most
  commonly forgotten.
- **Every screen is reviewed in both directions before it is called done.** Add a
  visual-regression or at minimum a screenshot check for both.

---

## 5. Arabic-specific details

- Arabic-Indic numerals (٠١٢٣) are a **display preference**, per tenant or per user.
  Storage and API are always Western Arabic numerals.
- Hijri dates are **displayed** alongside Gregorian on business documents where the
  tenant enables it. Use a library; never compute Hijri manually.
- Choose fonts with proper Arabic support and test at small sizes in tables — many UI
  fonts render Arabic poorly in dense DataTables.
- Arabic text is typically taller and wider than English at the same size. Layouts must
  not break; test with realistic long Arabic company names.

---

## 6. Money in the UI

- Amounts arrive as **strings**; parse with the shared decimal library.
- **No arithmetic on amounts in a component.** Totals come from the server. If the UI
  must show a provisional total (an unsaved line), it uses the same shared `Money`
  utilities and is visibly marked as provisional.
- **Never round for display in a way that changes a value the user will act on.**
  Display precision follows the currency's minor unit.
- Show the currency code explicitly wherever more than one currency can appear.

---

## 7. Forms

- One Zod schema per form, **mirroring the backend DTO** — the server remains the
  authority.
- Field-level errors in the user's language.
- Long forms (invoice, purchase order) autosave as draft or warn on navigation. Losing
  a half-entered 40-line invoice is a support ticket every time.
- Disable submit while pending and send an `Idempotency-Key` — double-click must not
  create two invoices.
- Keyboard-first data entry: accountants use keyboards, not mice. Tab order, Enter to
  add a line, numeric input behaviour, and shortcuts on high-volume screens matter more
  here than in most products.

---

## 8. Tables and reports

- Server-side pagination, sorting, and filtering. Never fetch everything and filter in
  the browser.
- Virtualise long lists.
- Column preferences, export to Excel/CSV/PDF — accountants will ask for this
  immediately, so design the export path once and reuse it.
- Exports are generated **server-side** for anything large or financial, so the exported
  numbers come from the same source as the report.

---

## 9. Quality

- TypeScript `strict`. No `any`. Generated API types only.
- No `useEffect` for data fetching — that is TanStack Query's job.
- Error boundaries per route; a failed widget must not blank the screen.
- Every async surface has explicit loading, empty, and error states. "Blank while
  loading" is not a state.
- Accessibility: labels on inputs, keyboard navigation, visible focus, sufficient
  contrast, correct `lang` and `dir`.
- Components are pure and presentational where possible; data fetching in hooks.
