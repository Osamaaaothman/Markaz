# Quotation correspondence, navigation and movement exports

Quotation emails now use the same server-rendered subject and plain-text content
for Gmail and direct delivery. Subjects identify the sending company and quotation.
The message contains a formal greeting, expiry where applicable, exact net/tax/gross
amounts, attachment description, reply instructions and the sales-team signature.
Download/attachment instructions are shown only to the operator in the app. Gmail
downloads the PDF before opening its prepared draft; the operator must attach it.
This change does not send mail automatically or configure production email credentials.

The expanded sidebar retains its original 288px width, colors, spacing and boxed
icons. Long navigation and section labels use a single line with an ellipsis;
desktop tooltips reveal the complete name on hover or keyboard focus, and links
retain their complete accessible names. Keyboard focus outlines and centered
collapsed icons remain. Existing permissions, section order, collapsed-state
preferences and mobile drawer behavior are preserved.

Stock movements provide PDF, CSV and print for current server filters, all movements,
or one selected movement. Local table search is disabled on this page so exports do
not silently ignore a second, client-only filter. The existing item, warehouse,
movement-type and inclusive date filters define the filtered report. RETURN is now
accepted by the API, matching the option already present in the UI.

`GET /v1/stock-movements/export` requires `stock:read`, keeps CSV as its default,
and accepts optional `format=csv|pdf`, `lang=ar|en`, and UUID `movementId`, alongside
the list filters. Pagination arguments never limit an export. A selected movement
remains company-scoped; missing or foreign-company IDs return 404. Reversed date
ranges return 400. Reports over 20,000 movements fail explicitly rather than
silently truncating. The UI explains the limit and displays export failures.

PDFs use landscape A4, bilingual names, signed quantities, four-decimal costs/values,
customer/supplier names and repeated table headers. Print uses the same PDF in the
browser's print dialog. CSV retains its existing columns and UTF-8 BOM for Excel.
There is no schema migration or new dependency.

Validation covers server DTOs, real-PostgreSQL row selection/filtering/isolation,
oversized-export rejection, escaped bilingual PDF HTML and recipient-ready email
copy. Visual fixtures include single-row and 70-row Arabic/English reports.
