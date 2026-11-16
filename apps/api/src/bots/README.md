# Chat bots (Bot Hub)

Connects the ERP to chat platforms. Design: [docs/BOTS-INTEGRATION-PLAN.md](../../../../docs/BOTS-INTEGRATION-PLAN.md).

```
packages/bots            platform adapters, no ERP knowledge
  contract/              ChannelAdapter, InboundEvent, Bot UI Kit (BotMessage), CredentialFieldSpec
  telegram/              Bot API over fetch: webhook (secret header) or long polling
  discord/               HTTP interactions (Ed25519) + REST: embeds, buttons, selects, modals
apps/api/src/bots        the Hub: everything platform-neutral
  api/                   settings + "my bots" endpoints, public webhook endpoint
  application/           connections, linking, runtime (dispatch, tokens, sessions), scheduler
  features/              menu · approvals · lookups · documents · reports · receipts
  bots-runtime.host.ts   BullMQ workers + Telegram pollers, inside the API process
```

## Adding a platform

1. `packages/bots/src/<provider>/` implements `ChannelAdapter` (declare `credentialFields`).
2. Add the id to `ProviderId` / `PROVIDER_IDS`, register it in `AdapterRegistry`, extend the
   `bot_connections_provider_check` constraint in a migration.
3. Add the `bots.<provider>.fields.*` labels and `bots.providers.<provider>` copy (AR + EN).

No feature, settings-page or runtime change is needed.

## Adding a feature

Write a `BotFeature` in `features/`: commands, actions (each behind an `Intent`), optional forms.
Return `BotMessage<Intent>` trees built with `feature-kit.ts`. Every string is a key in
`i18n/locales/{en,ar}/bots.json`. Check permissions with `ctx.can()` exactly as the matching web
endpoint does; state changes go through the same core service the web uses.

## Owned tables

`bot_connections`, `bot_identity_links`, `bot_link_codes`, `bot_action_tokens`, `bot_chat_sessions`,
`bot_broadcast_targets`, `bot_subscriptions`, `bot_alert_marks`, `bot_sent_messages`,
`bot_delivery_logs`, `bot_inbound_events` (migration `20261116180000_chat_bots`).

Reads (never writes) other modules' data only through their services, except: purchase orders
pending approval, recent supplier invoices / purchase orders (receipts picker), sales invoice
number search and ZATCA record status — read-only queries, scoped by `company_id`.

## Security model

- Tokens encrypted with `BOT_CREDENTIALS_ENCRYPTION_KEY` (AES-256-GCM, `application/bot-secret-box.ts`).
  The API returns only `{ set, last4 }`. Missing key → settings show a notice; nothing else breaks.
- Webhooks: Telegram `X-Telegram-Bot-Api-Secret-Token` (random per connection, constant-time
  compare); Discord Ed25519 signature + 5-minute timestamp window.
- A chat user acts only as a linked ERP user (one-time 10-minute code, hashed at rest). Deactivated
  users lose access on their next message.
- Buttons carry a random 22-character token; the intent lives in `bot_action_tokens`, bound to the
  user it was made for, with expiry and single use for state changes. Permission is re-checked when
  the button is tapped.
- Telegram groups: only `/chatid` and `/help`. Discord server channels: replies are ephemeral.
- Approvals above the connection's ceiling are refused in chat.
- Every state change is audited twice: the core service's own record plus `bot.*` with the channel.

## Operations

| Env | Purpose |
|---|---|
| `BOT_CREDENTIALS_ENCRYPTION_KEY` | required to connect any bot |
| `BOTS_PUBLIC_API_URL` | webhook mode and Discord (e.g. `https://erp.example.com/api`) |
| `BOTS_WEB_APP_URL` | "Open in ERP" buttons |
| `BOTS_RUNTIME=off` | HTTP-only replica (no bot workers) |

Queues: `bot-inbound`, `bot-delivery`, `bot-tick` (scan every minute, health every 15 minutes,
cleanup hourly). Telegram polling holds a Redis lock per connection, so replicas never double-poll.

## Testing

- `packages/bots`: renderer, parsing, signature and HTTP-client unit tests (fake `fetch`).
- `bots.integration.spec.ts`: real PostgreSQL + fake platform — linking, duplicate delivery,
  alert → confirm → approve, wrong user, permission re-check, reply-prompt rejection, revoked link.
- Not covered by automated tests: the live Telegram/Discord APIs (needs real bot credentials).

## Known gaps

- Not yet run against real Telegram/Discord accounts. Limits in the adapters (file sizes, Discord
  embed/components limits, Arabic not being a Discord command locale) were written from the
  platform docs and are marked `REVIEW` where uncertain.
- Discord on-premise without a public HTTPS address is not supported (no gateway client; D-BOT-4).
- Charts in reports are text-only (D-BOT-5).
- Alerts cover purchase-order approvals, low stock and ZATCA problems; purchase-request reviews and
  overdue-invoice digests are not alerted yet.
- Receipts can be attached to supplier invoices and purchase orders only.
- The bot runtime lives in the API process (documented exception to docs/02 §6).
