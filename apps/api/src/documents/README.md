# Company documents

All PDF endpoints render through `CompanyDocumentService`. It obtains the company
profile and verified logo using the authenticated company ID, then supplies the
shared letterhead to the PDF renderer. New PDF endpoints must use this service.
Document access and permission checks remain with each endpoint and Core service.

The shared shell controls typography, tables, totals and page spacing. The renderer
waits for embedded images and fonts, prints page numbers and the document reference,
repeats the document footer, and blocks remote network requests. Landscape reports
set their page size explicitly. A missing logo does not prevent a document export;
the company name remains visible and a structured diagnostic omits asset contents.

Buyer and supplier details come from the same-company party record. Missing tax or
address details are never invented. These presentation fields reflect the current
company and party profiles; this change does not rewrite posted invoices or signed
compliance artifacts. Existing QR and environment warnings remain intact.

`tafqeetAmount(amount, currency, language)` renders Arabic by default and English
when requested, at the same currency precision as displayed amounts. Preserve the
decimal string input. The word conversion does not calculate financial totals.

Quotation and notice emails use `notifications/email-shell.ts`: one accent color,
inline CSS, presentation tables and language-specific direction. Quotation logos
are embedded as data URIs for preview and converted to CID attachments by both mail
transports. Tests compose SMTP MIME locally and mock the Resend request; they never
send an email. Browser previews do not establish compatibility with every mail client.
