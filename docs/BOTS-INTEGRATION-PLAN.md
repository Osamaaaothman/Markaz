# Bots Integration — Full Plan (Telegram + Discord, reusable for any platform)

Status: **PLAN ONLY — nothing here is approved for implementation yet.**
Date: 2026-11-16

> **Scope warning (read first).** `docs/00-PRODUCT-BRIEF.md` §6 lists "external
> integrations" under **Tier 3 (not now)**. A bot integration is an external
> integration. This document is the design so the decision can be made with full
> information; **no code is written until Osama decides D-BOT-1 below** (§14).

---

## 0. Summary in ten lines

1. One **Bot Hub** module inside the API owns everything platform-neutral: identity
   linking, permissions, the command/action router, sessions, scheduled reports, delivery.
2. Each platform (Telegram, Discord, later WhatsApp/Slack/Teams) is a **Channel Adapter**
   behind one contract — exactly the same pattern as the ZATCA compliance pack.
3. Features never build Telegram or Discord payloads. They return a **platform-neutral
   message tree** (the *Bot UI Kit*: cards, tones, fields, tables, buttons, menus,
   pagination, files). Each adapter has a **renderer** that turns that tree into the
   richest thing its platform supports, and degrades gracefully where it cannot.
4. Each adapter **declares its credential fields**; the settings page renders the form
   from that declaration, so a new platform needs zero new settings UI code.
5. Credentials are encrypted at rest (AES-256-GCM, same pattern as ZATCA keys), never
   returned by the API, never logged.
6. A bot user is **always a linked ERP user**. Every request runs through the same
   `IPermissionService` checks as the web app. No anonymous bot access, ever.
7. Outbound messages go through the existing **outbox → BullMQ** path, so a crash after
   commit does not lose an approval request or a report.
8. Two transports per adapter: **webhook** (cloud-hosted customers) and **outbound
   polling/gateway** (on-premise customers with no public HTTPS URL).
9. High-value features: approvals with buttons, smart alerts, lookups with drill-down,
   documents as PDF/Excel, daily/weekly/month-end reports, receipts uploaded by photo.
10. Phased delivery: contract + Telegram first, Discord second, reports third.

---

## 1. Goals and non-goals

### Goals
- Connect the ERP to **any** chat platform by writing one adapter, nothing else.
- Feel like a **product**, not a command line: cards, colours/status, buttons,
  menus, in-place navigation, confirmations, files.
- Arabic and English from day one, per the user's ERP language preference.
- Respect every invariant in `CLAUDE.md` §1 — the bot is just another client.

### Non-goals (v1)
- **No creation or posting of financial documents from chat.** No invoices, payments,
  journal entries created in a bot. Reason: these need full forms, validation, review,
  and ZATCA flow; a chat UI invites mistakes in a system of record. (Revisit later via
  a Telegram Mini App / Discord modal that creates **drafts only**.)
- No AI/free-text "ask anything" in v1 (possible later phase, see §13).
- No customer-facing bot (a bot your *customers' customers* talk to). v1 is for the
  company's own staff. Customer-facing is a different security model.

---

## 2. Where it lives (architecture)

Follows `docs/02-ARCHITECTURE-RULES.md`. The bot is a **client of Core and of module
public APIs**, exactly like the web app — it never reads module tables directly.

```
packages/
  bots/
    contract/            ← platform-neutral types & interfaces (no Nest, no Prisma)
      src/
        channel-adapter.ts      ChannelAdapter, AdapterCapabilities
        inbound.ts              InboundEvent (normalized)
        ui-kit.ts               BotMessage tree (cards, buttons, ...)
        credentials.ts          CredentialFieldSpec
        index.ts
    telegram/            ← TelegramAdapter + TelegramRenderer + webhook verifier
    discord/             ← DiscordAdapter + DiscordRenderer + signature verifier
    testing/             ← shared adapter conformance test suite (§11)

apps/api/src/bots/       ← Bot Hub (NestJS module)
  bots.module.ts
  api/
    bot-connections.controller.ts   settings CRUD, test, enable/disable
    bot-webhooks.controller.ts      POST /bots/webhooks/:provider/:connectionId
    bot-links.controller.ts         link / unlink for the current user
    bot-subscriptions.controller.ts report subscriptions
  application/
    bot-router.service.ts           InboundEvent → feature handler
    bot-session.service.ts          short-lived conversation state
    bot-identity.service.ts         external user ↔ ERP user
    bot-delivery.service.ts         writes outbox messages for outbound sends
    bot-action-token.service.ts     maps short button ids → stored action payloads
    adapter-registry.ts             provider → adapter
  features/                         one folder per feature, each a BotFeature
    approvals/  alerts/  lookups/  documents/  reports/  receipts/  menu/
  jobs/
    bot-delivery.job.ts             outbox topic "bot-delivery" → adapter.send()
    bot-report.job.ts               scheduled reports
    bot-polling.job.ts              on-prem transport (Telegram getUpdates / Discord gateway)
    bot-health.job.ts               periodic connection health check
```

### Dependency direction
```
apps/api/src/bots  → packages/bots/contract
                   → packages/bots/telegram, packages/bots/discord  (only via adapter-registry)
                   → packages/core (IPermissionService, IAuditLogger, outbox)
                   → module public APIs (sales, inventory, purchasing, accounting reports)
packages/bots/telegram|discord → packages/bots/contract, packages/shared
```
Forbidden (add to the lint rule):
- `packages/bots/*` → `packages/modules/*` or `packages/core` (adapters know nothing about ERP).
- Anything in `features/` → `packages/bots/telegram|discord` (features are platform-blind).
- Any module → `apps/api/src/bots` (modules do not know bots exist; they emit domain
  events, the Bot Hub subscribes).

### Flow — inbound (user taps a button)
```
Telegram/Discord ──HTTPS──▶ bot-webhooks.controller
   1. adapter.verify(request)            signature / secret header  → 401 if bad
   2. adapter.parseInbound(request)      → InboundEvent (normalized)
   3. adapter.acknowledge(event)         fast ack (Discord: ≤3s deferred; Telegram: answerCallbackQuery)
   4. enqueue "bot-inbound" job          the heavy work never runs in the webhook request
                         │
bot-inbound job ─────────▼
   5. identity.resolve(event.sender)     → ERP user or "not linked" card
   6. router.dispatch(event)             → BotFeature.handle(ctx)
   7. feature calls Core / module APIs   with permission checks + audit
   8. feature returns BotMessage tree
   9. adapter.render(tree, capabilities) → platform payload
  10. adapter.send / adapter.edit        (edit in place for navigation)
```

### Flow — outbound (ERP event → message)
```
Purchase order needs approval (domain event, after commit)
   → Bot Hub event subscriber → decides recipients (users with approve permission AND a link
     AND the notification preference on)
   → writeOutboxMessage(topic "bot-delivery", payload: {recipient, messageTemplateId, params})
   → outbox relay → bot-delivery job → render in the recipient's language → adapter.send
```
The tree is rendered **at send time** from ids + params, not stored as text, so the
message reflects current state and the recipient's current language.

---

## 3. The adapter contract (the reusable heart)

```ts
// packages/bots/contract/src/channel-adapter.ts  (sketch — final shape at implementation)

export type ProviderId = "telegram" | "discord"; // extended per new adapter

export interface AdapterCapabilities {
  readonly colors: boolean;               // Discord: yes (embed/container accent). Telegram: no → emoji tone
  readonly richCards: boolean;            // structured fields
  readonly buttonsPerRow: number;         // Telegram ~8 practical, Discord 5
  readonly maxButtonRows: number;         // Discord 5, Telegram large
  readonly selectMenus: boolean;          // Discord native; Telegram → button list
  readonly modals: boolean;               // Discord native forms; Telegram: no (ForceReply / Mini App)
  readonly editMessages: boolean;         // both: yes
  readonly maxTextLength: number;         // Telegram 4096, caption 1024; Discord 2000 / embed 4096
  readonly maxActionIdBytes: number;      // Telegram callback_data 64 bytes; Discord custom_id 100 chars
  readonly maxUploadBytes: number;        // Telegram 50 MB; Discord ~10 MB (verify, §15)
  readonly inboundFiles: boolean;
  readonly transports: ReadonlyArray<"webhook" | "polling" | "gateway">;
}

export interface CredentialFieldSpec {
  readonly key: string;                   // "botToken"
  readonly kind: "secret" | "text" | "url" | "select";
  readonly labelKey: string;              // i18n key, e.g. "bots.telegram.fields.botToken.label"
  readonly helpKey: string;               // i18n key, how to obtain it
  readonly required: boolean;
  readonly pattern?: string;              // client + server validation
  readonly options?: ReadonlyArray<{ value: string; labelKey: string }>;
}

export interface ChannelAdapter {
  readonly provider: ProviderId;
  readonly capabilities: AdapterCapabilities;
  readonly credentialFields: ReadonlyArray<CredentialFieldSpec>;

  // lifecycle
  testConnection(creds: DecryptedCredentials): Promise<ConnectionTestResult>; // getMe / GET /applications/@me
  install(ctx: InstallContext): Promise<InstallResult>;   // set webhook / register commands & menu
  uninstall(ctx: InstallContext): Promise<void>;          // delete webhook / remove commands

  // inbound
  verify(req: RawInboundRequest, creds: DecryptedCredentials): VerifyResult;  // pure, no I/O
  parseInbound(req: RawInboundRequest): InboundEvent | null;
  acknowledge(event: InboundEvent, creds: DecryptedCredentials): Promise<void>;
  downloadFile(ref: InboundFileRef, creds: DecryptedCredentials): Promise<DownloadedFile>;

  // outbound
  render(message: BotMessage, locale: BotLocale): RenderedPayload;           // pure
  send(target: ChatTarget, payload: RenderedPayload, creds): Promise<SentMessageRef>;
  edit(ref: SentMessageRef, payload: RenderedPayload, creds): Promise<void>;
  sendFile(target: ChatTarget, file: OutboundFile, caption: BotMessage | null, creds): Promise<SentMessageRef>;
  showActivity(target: ChatTarget, kind: "typing" | "uploading", creds): Promise<void>;
}
```

### Normalized inbound event
```ts
export type InboundEvent =
  | { kind: "command";  sender: ExternalUser; chat: ChatTarget; name: string; args: string }
  | { kind: "action";   sender: ExternalUser; chat: ChatTarget; actionId: string; messageRef: SentMessageRef }
  | { kind: "select";   sender: ExternalUser; chat: ChatTarget; actionId: string; values: string[]; messageRef: SentMessageRef }
  | { kind: "form";     sender: ExternalUser; chat: ChatTarget; formId: string; fields: Record<string, string> }
  | { kind: "text";     sender: ExternalUser; chat: ChatTarget; text: string; replyTo?: SentMessageRef }
  | { kind: "file";     sender: ExternalUser; chat: ChatTarget; file: InboundFileRef; caption?: string }
  | { kind: "link";     sender: ExternalUser; chat: ChatTarget; code: string };   // /start CODE deep link
```
Every event carries `provider`, `connectionId`, `eventId` (for idempotency), `receivedAt`.

### Adding a new platform = this checklist only
```
[ ] packages/bots/<provider>/ implements ChannelAdapter
[ ] credentialFields declared (+ AR/EN help texts in locales)
[ ] renderer handles every BotMessage node (or declares degradation)
[ ] passes packages/bots/testing conformance suite
[ ] registered in adapter-registry.ts and the ProviderId union
[ ] no change in features/, no change in settings UI code
```

---

## 4. Bot UI Kit — the "design system" for chat

The goal: features describe **meaning** ("a warning card with 3 fields and two
actions"), the renderer decides **look**. This is how one feature looks professional
on Telegram *and* Discord without two implementations.

### 4.1 Message tree (platform-neutral)
```ts
export type Tone = "success" | "warning" | "danger" | "info" | "neutral" | "brand";

export interface BotMessage {
  readonly blocks: ReadonlyArray<Block>;
  readonly actions?: ReadonlyArray<ActionRow>;
  readonly files?: ReadonlyArray<OutboundFile>;
  readonly replaceable?: boolean;     // navigation edits this message instead of sending new ones
  readonly expiresAt?: Date;          // buttons stop working after this (approval links etc.)
}

export type Block =
  | { type: "header";  tone: Tone; icon: IconKey; titleKey: string; params?: Params; subtitleKey?: string }
  | { type: "text";    key: string; params?: Params; emphasis?: "normal" | "muted" | "strong" }
  | { type: "fields";  items: ReadonlyArray<{ labelKey: string; value: Value; inline?: boolean }> }
  | { type: "money";   labelKey: string; amount: MoneyDto; tone?: Tone }      // never number, see §4.5
  | { type: "table";   columns: Column[]; rows: Value[][]; totalRow?: Value[] } // max ~8 rows, else paginate
  | { type: "progress";labelKey: string; ratio: DecimalString; tone: Tone }   // e.g. budget used, stock level
  | { type: "divider" }
  | { type: "image";   file: OutboundFile; altKey: string }                  // charts (phase 4)
  | { type: "footer";  key: string; params?: Params };                       // "as of 14:05 · Branch Riyadh"

export interface ActionRow { readonly items: ReadonlyArray<Action> }
export type Action =
  | { type: "button"; style: "primary" | "secondary" | "success" | "danger"; labelKey: string; icon?: IconKey; action: ActionRef }
  | { type: "link";   labelKey: string; url: string }               // "Open in ERP" deep link
  | { type: "select"; placeholderKey: string; options: SelectOption[]; action: ActionRef }
  | { type: "pager";  page: number; pageCount: number; action: ActionRef };
```
`ActionRef` is **never** the raw payload. It is a short opaque id (§6.4) because
Telegram's `callback_data` is limited to 64 bytes and both platforms' ids are
user-visible to a determined client.

### 4.2 Tone system (colours that survive both platforms)

| Tone | Meaning | Discord (accent colour) | Telegram (no colours → emoji marker) | Used for |
|---|---|---|---|---|
| `success` | done / positive | green `#2E7D32` | 🟢 / ✅ | approved, paid, ZATCA cleared |
| `warning` | needs attention | amber `#F9A825` | 🟡 / ⚠️ | low stock, due soon, CSID expiring |
| `danger` | failure / overdue | red `#C62828` | 🔴 / ⛔ | rejected, overdue, ZATCA rejected, job dead-lettered |
| `info` | neutral fact | blue `#1565C0` | 🔵 / ℹ️ | lookups, reports |
| `brand` | company identity | company brand colour (from company settings) | company emoji/logo in header | daily report header |
| `neutral` | plain | grey `#607D8B` | ▫️ | menus |

Colour hex values must come from the web design tokens (`docs/design-system.md`) so
the bot matches the product; the table above is a placeholder until mapped.

### 4.3 Icon set
A closed enum `IconKey` (`invoice`, `cash`, `stock`, `approval`, `customer`,
`supplier`, `report`, `zatca`, `alert`, `calendar`, `file`, `chart`, `settings`…)
mapped per platform: Telegram → Unicode emoji; Discord → Unicode emoji, or
**application emojis** uploaded once by `install()` for a branded look. Features never
type an emoji literal.

### 4.4 Layout rules (enforced by renderer, documented for feature authors)
1. **One header per message**, tone + icon + title. The first glance tells the state.
2. **Max 6 fields** per card; more → table or "Details" button.
3. **Max 2 primary actions** per message; the rest go under a "More ⋯" select/submenu.
4. Destructive or approving actions always go through a **confirmation step** (§4.6).
5. Every message about a record has an **"Open in ERP"** link button (deep link to the
   web page) — the bot is a shortcut, the web app is the source of truth.
6. **Navigation edits the same message** (menu → list → detail → back). New messages
   only for notifications and files. Keeps the chat clean.
7. Lists: 5–8 items per page with a pager `◀ 2/7 ▶`. Never dump 50 lines.
8. Footer always shows "as of <time> · <company/branch>" so a stale message is obvious.
9. Long-running actions show activity (`typing` / `uploading document`) then edit the
   message to the result. Discord: deferred response then follow-up edit.
10. Expired buttons answer with a friendly "This action expired — open it again" card,
    never a silent failure.

### 4.5 Numbers, money, dates, direction
- Money arrives as `MoneyDto` (decimal string + currency) from module APIs, formatted
  by the shared formatter in the recipient's locale. **No `number` ever** (invariant 3).
- Digits: follow the company's interface setting (Latin vs Arabic-Indic).
- Dates: recipient's locale + company timezone (Asia/Riyadh default).
- RTL: both apps render Arabic RTL automatically from the text, **but** monospaced
  tables (`<pre>` on Telegram, code blocks on Discord) do not mix directions well.
  Rule: tables in Arabic use the field/list layout, not monospace columns; monospace
  tables only for numeric-only grids. Wrap mixed AR/EN fragments (invoice numbers,
  amounts) with Unicode isolates (`U+2068 … U+2069`) — renderer does it automatically.
- Every string is a translation key in `apps/api` server i18n (AR + EN), same rule as
  `docs/08-FRONTEND-I18N-RULES.md`. A bot message with a hard-coded string is a defect.

### 4.6 Standard interaction patterns (built once, reused by every feature)

| Pattern | Description |
|---|---|
| **Main menu** | `/start` or `/menu` → brand header + grid of buttons filtered **by the user's permissions** (a user without sales permission never sees "Sales"). |
| **Search → pick → detail** | User types or uses `/customer ahmad` → list of matches as buttons/select → detail card with actions. |
| **Confirm** | "Approve PO-2026-0142 for SAR 48,300.00?" `[✅ Confirm] [✖ Cancel]` — expires in 5 min, single use. |
| **Reason prompt** | Reject needs a reason: Discord → modal with a text field; Telegram → ForceReply prompt "Reply with the reason". |
| **Pager** | `◀ 2/7 ▶` editing in place. |
| **File delivery** | "Preparing PDF…" (uploading activity) → file message with a short caption card. |
| **Result card** | After an action, the original message is **edited** to its final state (e.g., green "Approved by Osama at 10:42") and buttons removed, so nobody taps twice. Others who got the same approval request see their copy updated too. |
| **Error card** | Red header, human message key, a correlation id in the footer for support. Never a stack trace. |

### 4.7 Visual mockups (text approximations)

**Approval request — Telegram**
```
🟡 ⏳ Purchase order awaits your approval
PO-2026-0142 · Al-Noor Trading Co.

Total        SAR 48,300.00
Requested by Khalid · Warehouse Riyadh
Items        12 lines
Threshold    above SAR 25,000.00

[✅ Approve] [⛔ Reject]
[📄 PDF]     [🔗 Open in ERP]
as of 10:41 · Main Company
```

**Same message — Discord** (embed / container with amber accent bar, fields in 2
columns, buttons: green *Approve*, red *Reject*, grey *PDF*, link *Open in ERP*).

**Daily report — both**
```
🏢 Daily summary — Sunday 15 Nov 2026
───────────────
💰 Sales today          SAR 128,450.00   ▲ 12% vs last Sunday
💵 Collections          SAR  96,200.00
🏦 Cash + bank          SAR 1,204,880.00
🔴 Overdue receivables  SAR 214,000.00   (9 customers)
⏳ Pending approvals    4
📦 Below reorder point  7 items
🧾 ZATCA                🟢 63 cleared · 🔴 1 rejected
───────────────
[📊 Full report PDF] [📥 Excel] [🔴 View rejected invoice]
as of 18:00 · Main Company
```

---

## 5. Features — what makes the bots genuinely useful

Ranked by value for a Saudi trading/distribution company. Each feature is a
`BotFeature` that declares: commands it answers, the permissions it needs, and the
domain events it listens to.

### 5.1 Approvals (highest value)
- Purchase orders above threshold, purchase requests, any approval policy from
  `/settings/approvals`.
- Sent to every user who **can** approve; first decision wins, everyone's message is
  edited to the final state.
- Approve → confirm step. Reject → reason (modal / reply). Both call the **same
  approval service** the web uses, so audit, permissions, and rules are identical.
- Audit record carries `channel: "telegram" | "discord"` and the external message id.
- Optional policy (decision D-BOT-6): above a second, higher amount, bot approval is
  disabled and the card only offers "Open in ERP".

### 5.2 Smart alerts (push)
| Alert | Audience (by permission) | Actions on the card |
|---|---|---|
| Item below reorder point | inventory | Create purchase request (opens ERP prefilled), View stock |
| Invoice overdue / due in N days | sales / collections | Customer statement PDF, Open customer |
| Large payment received | finance | Open receipt |
| ZATCA invoice rejected / warning | compliance admin | View errors, Open invoice |
| ZATCA CSID / certificate expiring | compliance admin | Open ZATCA settings |
| Background job dead-lettered | system admin | Open jobs page |
| Licence / maintenance expiring | owner | — |
| Fiscal period close reminder | accountant | Open period |

Each user chooses which alerts they get, per channel, in their profile (defaults by role).
**Quiet hours** per user (e.g., no non-critical alerts 22:00–07:00); critical alerts
(ZATCA rejected, dead-letter) bypass quiet hours.

### 5.3 Lookups (pull, read-only)
- `/customer <name|number>` → balance, credit limit, overdue, last invoice; buttons:
  Statement PDF, Aging, Open.
- `/supplier <…>` → balance payable, open POs.
- `/item <name|sku>` → stock per warehouse, reorder point, average cost (only if the user
  has cost-view permission), last purchase price.
- `/invoice <number>` → status, ZATCA status, amount, paid/remaining; PDF button.
- `/cash` → cash and bank balances per account (permission-gated).
- `/sales today|week|month` → totals vs previous period.
- `/approvals` → my pending approvals list with pager.
- All lookups are just the **main menu buttons** too — commands are a shortcut, not the
  only way.

### 5.4 Documents & files out
- Any document with a PDF in the web app (invoice, quotation, credit/debit note,
  customer statement, payment voucher) → **same server-side PDF renderer**
  (`apps/api/src/documents/pdf-renderer.ts`), sent as a file.
- Reports with export (trial balance, income statement, aging, general ledger,
  stock) → PDF or Excel via the existing export services.
- Files above the platform limit → send a short-lived, signed download link to the
  ERP instead (requires login; never a public URL).
- Every document sent is audited ("document X sent via telegram to user Y").

### 5.5 Files in (receipts & attachments)
- User sends a photo/PDF → bot asks "Attach to which record?" (recent documents as
  buttons, or search) → stored through the existing **attachments** service
  (`docs/attachments.md`), same validation (type sniffing, size, virus-scan rule if any).
- Use cases: supplier invoice photo onto a purchase invoice, delivery note onto a
  goods receipt, expense receipt.
- Never auto-creates a financial record from a file in v1.

### 5.6 Scheduled reports
- **Daily summary** (mockup above), **weekly** (sales by customer/item top 5, collections,
  aging buckets), **month-end** (income statement snapshot + trial balance PDF).
- Subscriptions are per user (DM) or per **broadcast channel** (a Telegram group /
  Discord channel the admin configures, §6.5).
- Each subscription: report type, schedule (preset times, not raw cron in UI),
  timezone, language, company/branch scope, format (card / card + PDF / card + Excel).
- Numbers come from the **ledger-based reporting layer** (`docs/02` §3.5), so the bot's
  numbers always tie to the trial balance. A bot report that does its own SQL sums over
  module tables is a defect.
- Phase 4+: chart images (sales trend) rendered server-side — needs a rendering
  dependency (decision D-BOT-5).

### 5.7 Later ideas (not v1, listed so the design does not block them)
- Telegram **Mini App** / Discord **Activity** for small forms (create a *draft*
  quotation, stock count entry) — reuses the web app's React pages.
- Natural-language questions ("how much did Al-Noor buy this quarter?") using an LLM
  over read-only report endpoints with the user's permissions.
- WhatsApp Business, Slack, Microsoft Teams adapters.
- Customer-facing bot (invoice copies / statements for customers) — separate security model.

---

## 6. Security model

### 6.1 Credentials at rest
- Stored in `bot_connections.credentials_ciphertext` encrypted with AES-256-GCM using
  `BOT_CREDENTIALS_ENCRYPTION_KEY` (env), same construction as
  `packages/compliance/zatca-sa/src/key-encryption.ts`. Extract that helper to
  `packages/shared` instead of copying it (one implementation, two consumers → justified).
- The API **never returns** a secret. GET returns `{ botToken: { set: true, last4: "x9Qa" } }`.
- Updating a secret requires re-typing it; blank means "keep current".
- Never logged: the logger redaction list gets every `kind: "secret"` field key.
- Missing encryption key → the bots settings page shows a clear "not configured" state
  (same pattern as `ENCRYPTION_KEY_MISSING` for ZATCA); the rest of the API still starts.

### 6.2 Inbound verification
- **Telegram:** `setWebhook` with a random `secret_token`; every request must carry the
  `X-Telegram-Bot-Api-Secret-Token` header matching it (constant-time compare). The
  webhook path also contains the `connectionId` (not the token).
- **Discord:** every interaction request is verified with **Ed25519** against the
  application's Public Key (`X-Signature-Ed25519` + `X-Signature-Timestamp`); reject
  stale timestamps. Discord itself probes this on setup and refuses an endpoint that
  doesn't verify.
- Failed verification → 401, rate-limited, logged (without body).
- Idempotency: `eventId` stored for 24h; a retried delivery is acknowledged and ignored.

### 6.3 Identity linking (who is this chat user?)
1. User opens **Profile → Linked chat accounts → Link Telegram** in the web app.
2. Server creates a one-time code (random, 32+ bytes, **stored hashed**, 10-minute
   expiry, single use) and shows:
   - Telegram: a deep link `https://t.me/<bot>?start=<code>` + QR code.
   - Discord: "Run `/link <code>` with the bot in a DM" (or OAuth2 later).
3. Bot receives the code → links `external_user_id` to the ERP user → confirms in both
   places. Audit record written.
4. Unlink: from the web profile, or `/unlink` in the bot. **Deactivating an ERP user
   revokes all links immediately.** Password reset / role change does not unlink, but
   permissions are re-checked on every request anyway.
- An unlinked chat user gets only a "Link your account" card. Nothing else.

### 6.4 Action tokens (buttons)
- Button ids are short random tokens → row in `bot_action_tokens` with
  `{ connectionId, userId, chatId, feature, payload, expiresAt, singleUse, usedAt }`.
- On tap: token must exist, not expired, belong to the **same linked user** who taps it
  (in groups, someone else tapping your approval button gets "not for you"), then the
  permission is **re-checked at tap time** (rights may have changed since sending).
- Single-use for state-changing actions; double-tap safe.

### 6.5 Groups and channels (data-leak risk)
- **Default: private chats (DM) only.** A group/channel is a different audience.
- Admin may register a group/channel as a **broadcast target** for specific report
  types only. Each target has an explicit **data scope** (e.g., "sales totals, no
  customer names, no costs"). Lookups and approvals never work in groups.
- Discord: install with minimum permissions (send messages, embed links, attach files,
  use application commands) — no Administrator, no message-content intent unless a
  feature needs it.

### 6.6 Other rules
- Rate limit per linked user (e.g., 30 actions/min) and per connection.
- PII minimisation in pushes: notifications show what's needed to decide; national IDs,
  bank account numbers, salaries never appear in a bot message. Payroll/HR excluded from
  bots in v1.
- Every state-changing action → `IAuditLogger` with channel metadata. If audit fails,
  the action fails (invariant 8).
- Kill switch: disabling a connection stops inbound processing and outbound delivery at
  once; pending outbox messages for it are marked skipped, not lost silently.
- Remember: telegram/discord servers see message content. Write this in the customer
  docs; some customers may forbid it — another reason the feature must be off by default.

---

## 7. Data model (Prisma sketch — follows `docs/04-DATA-MODEL-RULES.md`)

```prisma
model BotConnection {
  id                     String   @id @default(uuid())
  companyId              String
  provider               String              // "telegram" | "discord"
  displayName            String
  status                 String              // draft | active | disabled | error
  transport              String              // webhook | polling | gateway
  credentialsCiphertext  Bytes               // AES-256-GCM, never selected by default queries
  credentialsKeyVersion  Int                 // key rotation
  webhookSecretHash      String?             // Telegram secret_token (hash) / unused for Discord
  publicIdentity         Json                // non-secret: bot username, application id, avatar
  settings               Json                // default language, quiet hours default, enabled features
  lastHealthAt           DateTime?
  lastHealthStatus       String?
  createdAt / createdBy / updatedAt / updatedBy
  @@unique([companyId, provider])            // v1: one bot per provider per company (D-BOT-3)
}

model BotIdentityLink {
  id              String   @id @default(uuid())
  connectionId    String
  userId          String                     // ERP user
  externalUserId  String                     // Telegram user id / Discord user snowflake (string!)
  privateChatId   String                     // where DMs go
  externalHandle  String?                    // @username, for display only
  linkedAt        DateTime
  revokedAt       DateTime?
  revokedReason   String?
  @@unique([connectionId, externalUserId])   // partial unique where revokedAt is null (raw SQL migration)
}

model BotLinkCode { id, connectionId, userId, codeHash, expiresAt, usedAt }

model BotActionToken { id (short random), connectionId, userId, chatId, feature, payload Json,
                       singleUse Boolean, expiresAt, usedAt }

model BotBroadcastTarget { id, connectionId, chatId, title, allowedReports String[], dataScope Json,
                           createdBy, createdAt, disabledAt }

model BotSubscription { id, connectionId, userId?, broadcastTargetId?, reportType, scheduleKey,
                        timezone, language, scope Json, format, lastRunAt, nextRunAt, disabledAt }

model BotNotificationPreference { userId, provider, alertType, enabled, quietHours Json? }

model BotDeliveryLog { id, connectionId, recipientRef, kind, templateId, status, attempts,
                       externalMessageId?, errorCode?, createdAt }   // operational log, not audit
model BotInboundEvent { connectionId, eventId, receivedAt }          // idempotency, TTL-cleaned
```
- Discord ids are 64-bit snowflakes → **always strings**, never `Int`/`Number`.
- `BotDeliveryLog` is an operational table (can be pruned per retention policy); the
  *audit* of business actions goes to the real audit log.

---

## 8. Settings page — credentials per platform

Route: **`/settings/integrations/bots`** (permission `integrations.bots.manage`).
Built with PrimeReact, physical-CSS overrides per project rule, AR/EN + RTL/LTR.

### 8.1 Page layout
```
Integrations › Chat bots
┌──────────────────────────┐ ┌──────────────────────────┐ ┌──────────────────────────┐
│ [TG logo] Telegram       │ │ [DC logo] Discord        │ │ WhatsApp · Slack · Teams │
│ ● Active  @markaz_bot    │ │ ○ Not connected          │ │ Coming later (disabled)  │
│ 14 linked users          │ │                          │ │                          │
│ Last check 2 min ago ✓   │ │ [Connect]                │ │                          │
│ [Manage] [Disable]       │ │                          │ │                          │
└──────────────────────────┘ └──────────────────────────┘ └──────────────────────────┘
```
Provider cards come from `GET /bots/providers` → each adapter's `provider`,
`capabilities`, `credentialFields`. The UI does not hard-code providers.

### 8.2 Connect / Manage dialog (a stepper)
1. **How to get credentials** — localized step-by-step help from `helpKey`s, with
   screenshots, link to BotFather / Discord Developer Portal.
2. **Credentials form** — generated from `credentialFields`:
   - **Telegram:** `botToken` (secret, pattern `^\d+:[A-Za-z0-9_-]{30,}$`),
     `transport` (select: webhook — recommended for cloud / polling — for on-premise without public URL).
   - **Discord:** `applicationId` (text, digits), `publicKey` (text, hex 64),
     `botToken` (secret), `guildId` (text, optional — register commands to one server
     instantly instead of globally), `transport` (webhook interactions / gateway).
   Secret inputs are password fields with show/hide, paste-friendly, never prefilled.
3. **Test connection** — server decrypts nothing yet: it validates with the provided
   values (Telegram `getMe`, Discord `GET /applications/@me` + bot user) and shows bot
   name + avatar. Save is disabled until the test passes.
4. **Install** — set webhook / register commands, menu button, command descriptions
   (both languages where the platform supports it). Shows the webhook URL (read-only,
   copy button) — for Discord the admin pastes it into *Interactions Endpoint URL* in
   the Developer Portal; the dialog says so explicitly. For Discord, it also shows the
   **invite link** with the minimum permission set.
5. **Done** — status Active, link to "Link my account".

### 8.3 Manage tab set for a connection
- **Overview:** status, health history, transport, webhook URL, bot identity.
- **Credentials:** masked values (`••••x9Qa`), "Replace token", "Rotate webhook secret".
- **Features:** toggles — approvals, alerts, lookups, documents, receipts, reports.
- **Linked users:** list (ERP user, handle, linked at) with "Revoke".
- **Broadcast targets:** groups/channels, allowed reports, data scope.
- **Delivery log:** last N deliveries with status, filters, retry failed.
- **Danger zone:** disable, delete (deletes credentials; keeps audit; revokes all links).

### 8.4 User-side pages
- **Profile → Linked chat accounts:** link/unlink per active provider, QR code for Telegram.
- **Profile → Notifications:** matrix of alert types × channels (email, Telegram,
  Discord) + quiet hours + report subscriptions. This makes "bots" one notification
  channel among others, next to email — which is the right mental model.

### 8.5 API endpoints (per `docs/07-API-RULES.md`)
```
GET    /bots/providers                         adapters + credential field specs
GET    /bots/connections                       list (no secrets)
POST   /bots/connections/test                  test unsaved credentials
POST   /bots/connections                       create (Idempotency-Key)
PATCH  /bots/connections/:id                   update non-secret / replace secret
POST   /bots/connections/:id/install           (re)install webhook + commands
POST   /bots/connections/:id/enable|disable
DELETE /bots/connections/:id
GET    /bots/connections/:id/links             linked users
DELETE /bots/connections/:id/links/:linkId     revoke
GET    /bots/connections/:id/deliveries        delivery log
POST   /bots/me/link-codes                     create my link code → deep link / QR
DELETE /bots/me/links/:linkId                  unlink myself
GET|PUT /bots/me/preferences                   alerts + quiet hours
CRUD   /bots/me/subscriptions                  personal reports
CRUD   /bots/connections/:id/broadcast-targets
POST   /bots/webhooks/:provider/:connectionId  public, verified by adapter, no JWT
```

---

## 9. Platform specifics

### 9.1 Telegram
- Transport: **webhook** (`setWebhook` + `secret_token`, HTTPS required) or
  **long polling** (`getUpdates`) for on-premise. Never both at once (Telegram rejects
  `getUpdates` while a webhook is set) — the install step switches cleanly.
- UI: HTML `parse_mode` (escape everything — reuse `common/html-escape.ts`), inline
  keyboards, `editMessageText` / `editMessageReplyMarkup` for navigation,
  `answerCallbackQuery` (toast) on every tap, `sendChatAction` for activity,
  `ForceReply` for text input, bot menu button + `setMyCommands` with `language_code`
  `ar` and `en`.
- Files: `sendDocument` (≈50 MB upload), `getFile` download (≈20 MB) — verify §15.
- Deep link `t.me/<bot>?start=<payload>` for account linking (payload ≤ 64 chars,
  `[A-Za-z0-9_-]`).
- Limits to respect in the delivery queue: ~1 msg/s per chat, ~30 msg/s overall,
  ~20 msg/min per group; honour `retry_after` on 429.
- Library: **none needed** — a thin typed HTTP client (~300 lines) over `fetch`
  avoids a dependency; alternative is `grammY` (decision D-BOT-4).

### 9.2 Discord
- Transport: **HTTP Interactions endpoint** (Ed25519-verified) for slash commands,
  buttons, selects, modals — no websocket needed. Proactive messages (alerts, reports,
  DMs) use the REST API with the bot token. **Gateway** (websocket, outbound only) is
  the fallback for on-premise without a public URL — needs a library
  (`@discordjs/ws` or `discord.js`) → decision D-BOT-4.
- Must acknowledge within **3 seconds** → always respond with a *deferred* response
  then edit; the interaction token allows follow-ups for 15 minutes.
- UI: embeds (accent colour, fields, footer, thumbnail) or the newer **Components V2**
  layout (containers with accent colour, sections, text displays, media gallery,
  separators) — renderer picks one; buttons (primary/secondary/success/danger/link),
  string select menus, **modals** for reject reasons, ephemeral replies for private
  answers inside a server channel.
- Files: multipart attachments; bot upload limit is small (≈10 MB at time of writing —
  verify) → large exports go as signed ERP links.
- Localization: Discord's command-localization locales **do not include Arabic** (verify
  at implementation). Command names stay English (`/invoice`, `/customer`), but all
  *content* follows the user's ERP language — the linked user's preference wins over the
  Discord client locale.
- DMs require the user to share a server with the bot or have it user-installed;
  linking flow covers this.
- Rate limits: per-route buckets from response headers; the delivery job respects
  `X-RateLimit-*` and 429 `retry_after`.

---

## 10. Jobs, delivery, reliability

| Queue / topic | Producer | Consumer | Notes |
|---|---|---|---|
| `bot-inbound` | webhook controller / polling job | Bot router | idempotent on `eventId`; 3 retries |
| `bot-delivery` (outbox topic) | features, event subscribers, reports | adapter.send/edit/sendFile | per-connection rate limiter; backoff + jitter; DLQ + admin alert |
| `bot-report` (repeatable) | scheduler | report builder → `bot-delivery` | one job per due subscription; carries companyId + correlationId |
| `bot-polling` | worker start (polling/gateway connections only) | adapter | single active consumer per connection (Redis lock) |
| `bot-health` (every 15 min) | scheduler | adapter.testConnection | status → settings page; alert on repeated failure |

- Event → message decisions happen **after commit** (domain events), written via the
  outbox in their own transaction — never an HTTP call inside a DB transaction.
- A blocked bot (user blocked it / left the server) → mark link `unreachable`, stop
  retrying, show it on the user's profile.
- Every job carries `companyId` and `correlationId` (`docs/02` §6).

---

## 11. Testing plan (`docs/10-TESTING-RULES.md`)

- **Adapter conformance suite** (`packages/bots/testing`): one suite, run against every
  adapter — renders every Block/Action type, both locales, respects every capability
  limit (id length, text length, button counts), verify() rejects bad signatures /
  stale timestamps, parseInbound() round-trips fixture payloads.
- **Renderer snapshot tests:** each mockup in §4.7 × {AR, EN} × {Telegram, Discord}.
- **Security tests:** unlinked user gets nothing; other user's action token rejected;
  permission revoked between send and tap → rejected; expired / reused token rejected;
  group chat cannot run lookups; secrets never appear in any API response or log line.
- **Integration tests:** approval via bot produces the same audit + state as via web;
  outbox survives a crash after commit; report numbers equal the trial balance numbers.
- **Manual E2E:** a real test bot on each platform in a test group/server before every
  release of this module (tokens kept out of the repo; Osama owns them).

---

## 12. Phased delivery plan

Each phase is a branch per `docs/11-GIT-WORKFLOW.md`, ends with tests + ownership package.

| Phase | Branch | Delivers | Exit gate |
|---|---|---|---|
| **P0** | — | Decisions §14 answered; this plan updated to "approved" | Osama sign-off |
| **P1** Foundation | `feat/bots-foundation` | `packages/bots/contract`, encryption helper moved to shared, Prisma models + migration, Bot Hub skeleton, settings page (provider cards, dynamic credential form, test/install/disable), profile linking page | conformance suite exists; settings page AR/EN/RTL verified |
| **P2** Telegram v1 | `feat/bots-telegram` | Telegram adapter (webhook + polling), main menu, account linking, approvals with confirm/reject-reason, 3 alerts (approval, reorder, ZATCA rejected) | full flow on a real test bot, both languages |
| **P3** Discord v1 | `feat/bots-discord` | Discord adapter (interactions + REST; gateway if D-BOT-4 allows), same features as P2 with zero feature-code changes | conformance + same E2E on a test server — proves the abstraction |
| **P4** Lookups & documents | `feat/bots-lookups-documents` | customer/supplier/item/invoice/cash lookups, PDF/Excel delivery, signed-link fallback | permission matrix tests |
| **P5** Reports | `feat/bots-reports` | subscriptions, daily/weekly/month-end, broadcast targets with data scope, quiet hours | report totals reconcile with trial balance |
| **P6** Files in | `feat/bots-receipts` | photo/PDF → attachments flow | attachment rules tests |
| **P7** (optional) | later | charts, Mini App drafts, more providers, LLM Q&A | separate decisions |

Rough size (honest): P1 ≈ 1.5–2 weeks, P2 ≈ 1.5 weeks, P3 ≈ 1 week, P4 ≈ 1 week,
P5 ≈ 1 week, P6 ≈ 0.5 week — for one developer with this codebase, excluding review.

---

## 13. Risks and weak points (blunt)

- **Scope creep:** this is Tier 3 by the product brief. Building it before M10
  (pre-launch hardening) delays the first paying customer.
- **On-premise reachability:** webhooks need public HTTPS; polling/gateway works but adds
  a long-lived consumer to operate and monitor.
- **Data leaves the deployment:** Telegram/Discord servers see every message. Some
  Saudi customers (or their regulators) may not accept that for financial data. Must be
  opt-in per company and documented.
- **Approvals from a phone** are convenient and riskier (stolen unlocked phone). Mitigated
  by confirmation, expiry, threshold policy (D-BOT-6), instant revoke on deactivation —
  not eliminated.
- **Discord in a business context** is uncommon in the Gulf; Telegram and especially
  **WhatsApp** are far more used. WhatsApp Business API is paid, template-approved, and
  has a stricter model (24h window, 3 buttons max) — the capability-driven renderer is
  designed for that, but it is a real separate project.
- **Platform API drift:** both APIs evolve (Discord Components V2 is recent). Adapters
  need maintenance; the conformance suite catches regressions, not new features.
- **Arabic in monospace tables** renders badly — the layout rules avoid it, but a careless
  feature author can still produce ugly output; snapshot tests are the guard.

---

## 14. Decisions needed from Osama

```
DECISION NEEDED — D-BOT-1: Is the bots integration in scope now?
What:     Product brief puts "external integrations" in Tier 3 (not now).
Why:      CLAUDE.md §7 forbids building Tier 2/3 without an explicit decision.
Options:  A) Approve now, after M10 hardening is done — keeps launch on track
          B) Approve now, in parallel — faster bots, slower launch
          C) Defer — keep this plan only
          Recommendation: A, and update 00-PRODUCT-BRIEF §6 to move it to Tier 1.5 explicitly.
Blocking: yes, for all phases
```
```
DECISION NEEDED — D-BOT-2: Which platforms first?
Options:  A) Telegram then Discord (as requested)
          B) Telegram then WhatsApp Business (more common for Gulf businesses; paid API)
          Recommendation: A for the abstraction proof (Discord is free and very different
          from Telegram, so it really tests the contract); add WhatsApp as the 3rd adapter.
Blocking: P3
```
```
DECISION NEEDED — D-BOT-3: One bot per provider per company, or per branch?
Options:  A) One per provider per company (simple; branch is a data scope)
          B) Several (e.g., separate bot per branch)
          Recommendation: A.
Blocking: P1 (schema unique key)
```
```
DECISION NEEDED — D-BOT-4: New dependencies?
What:     Telegram: hand-written thin client vs grammY. Discord: Ed25519 verify can use
          node:crypto (no dependency); gateway needs @discordjs/ws or discord.js.
Options:  A) No new deps; Discord on-prem uses webhooks via a tunnel/reverse proxy only
          B) Add @discordjs/ws for gateway mode (on-prem without public URL)
          Recommendation: A for P1–P3; revisit B when the first on-prem customer wants Discord.
Blocking: P3
```
```
DECISION NEEDED — D-BOT-5: Charts in reports?
What:     Chart images need a server-side renderer (e.g., a canvas/SVG→PNG library).
Options:  A) Text-only reports with ▲▼ trends (no dependency)  B) Add a chart renderer
          Recommendation: A for v1.
Blocking: P5 only for charts
```
```
DECISION NEEDED — D-BOT-6: Approval limits on bots
What:     Should approvals above an amount be blocked from chat (web-only)?
Options:  A) Yes, configurable per company, default = no ceiling
          B) Yes, default ceiling set at install
          C) No ceiling at all
          Recommendation: A — needs an accounting/business judgement from Osama.
Blocking: P2
```
```
DECISION NEEDED — D-BOT-7: Data leaving the deployment
What:     Message contents pass through Telegram/Discord servers.
Options:  A) Off by default; admin must tick an explicit acknowledgement to enable
          B) On by default
          Recommendation: A, plus a line in customer contracts/docs.
Blocking: P1 (settings UX)
```

---

## 15. Verify against current official docs before implementing

Platform limits change. Each value below was written from memory and **must be checked
against official docs at implementation time**, then recorded in the adapter's
`capabilities` with a link:
- Telegram: Bot API current version; `callback_data` 64 bytes; text 4096 / caption 1024;
  upload 50 MB / download 20 MB; rate limits; `secret_token` header name; `setMyCommands`
  language codes.
- Discord: bot attachment size limit; Components V2 availability and limits; embed limits
  (total 6000 chars, 25 fields); 3-second interaction deadline / 15-minute token;
  supported command localization locales (Arabic?); DM rules for user-installed apps.
```
