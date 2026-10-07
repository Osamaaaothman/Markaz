# Attached documents (scanned bills, receipts, supporting files)

Lets a user attach a PDF or a photo to a record (sales invoice, supplier invoice, receipt or payment, journal entry,
purchase order, party, item) and later open, download or remove it. A **Documents** screen lists every attached file
in the company.

## What it does and does not do

- Accepted: **PDF, PNG, JPEG, WebP**, up to **10 MB** each (configurable, hard ceiling 50 MB).
- The type is decided from the file's **first bytes**, never from the name or the browser's claim. A script renamed
  `.pdf` is refused.
- The original file name is kept for display only. The storage key is random and never built from the name.
- **A file is never edited.** "Remove" marks it removed (the row and the stored file are kept for retention) and it
  stops being listed. The database role used by the API cannot `DELETE` a row or change anything except the two
  `deleted_*` columns (migration `20261009090000_attachments`).
- Every upload and removal is written to the audit log. Opening a file re-checks its SHA-256 against the value stored
  at upload, so a file changed behind the application's back is refused.

## Who can see a file

Two checks, both in `AttachmentService` (not only in the controller):

1. The role must have `attachment:read` / `attachment:create` / `attachment:delete`.
2. The user must also be allowed to **read the record itself** (for example `sales_invoice:read`). Nobody opens a scan of
   an invoice they cannot open. Someone without that right gets "not found", so the file's existence is not revealed.

Another company's files are invisible (every query carries the company id).

## Private and public

Visibility is decided by the **record type**, in one table (`packages/core/src/attachments/attachment-rules.ts`), never by
the user:

| Record | Visibility |
|---|---|
| Item pictures | PUBLIC (may be delivered by a permanent link when the storage allows it) |
| Everything else | PRIVATE (no link at all; the API streams the bytes after the permission check) |

The same rule is a database CHECK (`attachments_public_only_items_check`), so it holds even if code is changed wrongly.
A new record type is private until someone adds it to the table on purpose.

> Item pictures have no screen yet (known gap below). The company logo is not an attachment yet either.

## Where the files are stored

Set in `.env` (see `.env.example`):

| `ATTACHMENT_STORAGE` | Where | Notes |
|---|---|---|
| `local` (default) | The `attachments_data` Docker volume, mounted at `/data/attachments` | Works with no setup. **Back it up with the database.** |
| `cloudinary` | A Cloudinary account | Needs `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`. The API refuses to start if one is missing. |

Switching later is safe: each row remembers which storage holds its file, and both stay readable.

With Cloudinary, private files are stored as `authenticated` assets (no public URL exists) and the API server downloads
them through a signed URL on the user's behalf. The secret is read only in `apps/api/src/attachments/attachments.config.ts`,
never logged and never sent to the browser. **Never put the three Cloudinary values in git or in chat; only in `.env`.**

### Verifying Cloudinary (run it for every new Cloudinary account)

The Cloudinary code (`cloudinary-file-storage.ts`) was written from Cloudinary's documentation and **verified on
2026-10-07 against a real account** (all checks passed: private round trip with identical bytes, no access without a
signature, public picture, cleanup). Run the check again for each customer's own Cloudinary account and after any change
to that file:

0. Automatic check against the real account (creates and then removes two test files; does not change the setting):
   `npm run build -w packages/core` then `node --env-file=.env packages/core/scripts/check-cloudinary.mjs`.
   It uploads a private PDF and reads it back through the signed path, checks the bytes, checks the private file is
   refused without a signature, does the same for a public picture, and cleans up. Nothing secret is printed.
1. Put the three values in `.env`, set `ATTACHMENT_STORAGE=cloudinary`, `docker compose up -d api`.
2. Upload a PDF to any record in the app, then open it and download it. The bytes must open normally.
3. In the Cloudinary console, confirm the file is under `markaz/` as `raw` / `authenticated`.
4. If the upload works but opening fails (or the reverse), the signing of the delivery URL is the likely culprit
   (`signCloudinaryDeliveryPath`): report it, do not work around it.
5. A new Cloudinary account may block delivery of PDF files by default; if PDFs fail while images work, check the
   account setting that allows delivery of PDF and ZIP files.

### Data residency

Cloudinary stores files in its own regions, and (to our knowledge) not in Saudi Arabia. For a customer who must keep
data in the Kingdom (`docs/01-OPEN-DECISIONS.md` A2) use `local` storage on their own hardware or an in-Kingdom host.
Verify the current region options against Cloudinary's own documentation before offering it.

## API

| Call | Permission | Notes |
|---|---|---|
| `POST /v1/attachments` (multipart: `ownerType`, `ownerId`, `file`) | `attachment:create` | One file per request |
| `GET /v1/attachments?ownerType=&ownerId=` | `attachment:read` | Files of one record |
| `GET /v1/attachments?ownerType=&q=&cursor=&limit=` | `attachment:read` | Company-wide, paged, only types the user may read |
| `GET /v1/attachments/:id/content[?download=true]` | `attachment:read` | Streams the bytes; `nosniff`, `no-store`, sandboxed |
| `DELETE /v1/attachments/:id` | `attachment:delete` | Marks removed |

Errors carry a `code`: `UNSUPPORTED_FILE_TYPE` (415), `FILE_TOO_LARGE` (413), `EMPTY_FILE`, `OWNER_NOT_FOUND` (404),
`FORBIDDEN_OWNER` (403), `NOT_FOUND` (404), `INTEGRITY_FAILED` (500).

## Known gaps

- No virus scanning (the hook point is `AttachmentService.upload`, before `put`). Needed before accepting files from
  people outside the company.
- No per-user rate limit on uploads yet.
- A removed attachment's file stays in storage forever (retention). A purge policy is a decision for the accountant and
  the customer, not built.
- Item pictures and the company logo have no screens (the rule and storage support them).
- Uploading to a record that is created in the same screen (a new supplier invoice form) is not offered: save the
  invoice, then use the paperclip on its row.
- Cloudinary secrets sit in `.env`. Rotate the API secret in the Cloudinary console if it was ever pasted into a chat,
  ticket or email, then update `.env` and restart the API.
- If saving the database row fails after the file is stored, an unreferenced file remains in storage. Harmless and
  invisible; a cleanup job could list files with no row.
