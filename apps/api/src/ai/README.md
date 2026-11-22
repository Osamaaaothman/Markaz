# AI assistant (API)

Plan and reasoning: [docs/Planning/ai-assistant-plan.md](../../../../docs/Planning/ai-assistant-plan.md).
Decisions: `docs/01-OPEN-DECISIONS.md` → "AI assistant". Lessons: `docs/Planning/guides/ai-lesson-*.md`.

## Layers

| Layer | Where | Knows about |
|---|---|---|
| Engine | `packages/ai` | LangChain / LangGraph, tool contracts, modes, approvals. No database, no Nest. |
| Tools | `tools/erp-tools.ts`, `report-tools.ts`, `sales-tools.ts`, `document-tools.ts` | Master data and writes; report services; quotation creation; read-only lists of every document type (journal entries, quotations, orders, delivery notes, supplier invoices, payments, cash expenses, stock movements, warehouses, goods receipts, purchase requests, fixed assets, payroll, salary advances) plus the trial balance. Framework-free. |
| Orchestration | `ai-chat.service.ts` | Permissions, history, persistence, usage. Calls the engine. |
| HTTP | `ai.controller.ts`, `mcp/ai-mcp.controller.ts` | SSE streaming, settings, MCP. |

## Rules the code enforces

- The model never touches the database. A tool calls the same service the web endpoint calls, as the
  signed-in user, with that user's permissions (checked when the tool list is built **and** when it runs).
- **Ask** mode does not offer write tools to the model at all. **Review** turns every write into a
  proposal (`ai_change_items`, status `PROPOSED`). **Auto** runs low-risk writes at once only when the
  company switch *and* `ai_assistant:auto` allow it; high-risk tools always wait.
- A decided change item is frozen by a trigger. A decision is claimed by flipping the conversation from
  `AWAITING_APPROVAL` to `IDLE` atomically, so a second click cannot run the same items twice.
- Writes carry correlation id `ai:<conversationId>` into the audit log.
- Provider keys are AES-256-GCM sealed with `AI_CREDENTIALS_ENCRYPTION_KEY`, write-only in the API,
  never logged. Provider errors leave the server only as coarse codes.
- Tool results reach the model inside an `untrusted_data` envelope (see `packages/ai/src/safety`).

## Endpoints

| Method | Path | Permission |
|---|---|---|
| POST | `/v1/ai/messages` (SSE) | `ai_assistant:use` (+ `interact` for review/auto) |
| POST | `/v1/ai/conversations/:id/decisions` (SSE) | `ai_assistant:interact` |
| GET/PATCH/DELETE | `/v1/ai/conversations[/:id]` | `ai_assistant:use` (own conversations only) |
| GET | `/v1/ai/me` | `ai_assistant:use` |
| GET/PUT | `/v1/ai/settings`, POST `/v1/ai/settings/test` | `ai_settings:manage` |
| POST | `/v1/ai/mcp` (MCP Streamable HTTP, read tools only) | `ai_assistant:use` |

## Adding a tool

1. Add it to `tools/erp-tools.ts` with `defineReadTool` / `defineWriteTool`: a zod input, the real
   permission of the matching endpoint, an English description written for the model, and for writes a
   `preview` that does not write and a `risk`.
2. Add `ai.tool.<name>` (and preview / column keys) to both locale files.
3. A write that posts to the ledger, moves money, sends something out or cannot be undone is
   `risk: "high"`.

## Context and compaction

Every turn sends the conversation so far, so follow-up questions work ("its details", "the second one").
When the history passes ~24k estimated tokens (`AI_COMPACT_AT_TOKENS` to change), the older part is
folded into a model-written summary stored on `ai_conversations.summary`; only messages after
`summary_through_seq` are sent, with the summary as memory in the system prompt. The cut always starts
at a user message. The user still sees every message, with a divider where it happened. A failed
summary never blocks the message (the history is then trimmed to the last 40 messages).

## Configuration

`AI_CREDENTIALS_ENCRYPTION_KEY` (required to save a key from the settings page). Optional server default
until an admin saves one: `AI_PROVIDER`, `AI_MODEL`, `AI_BASE_URL`, `AI_API_KEY` / `GEMINI_API_KEY`.

## Known Gaps

- No high-risk tools yet (posting invoices, payments, payroll runs). The approval path supports them;
  each needs its own review before it is offered.
- No sales-invoice *draft* from a sentence (plan feature 4): the web draft payload format is not a
  stable contract yet.
- No RAG over the user guides (plan feature 11), no supplier invoice from a photo (feature 7), no
  anomaly detection or proactive dashboard insights (features 9, 13), no saved macros (feature 12).
- MCP uses the normal short-lived bearer token; personal access tokens for desktop AI clients are not built.
- Multi-step changes are not atomic (D-AI-5).
- Dictation uses the browser's Web Speech API (Chrome/Edge); other browsers hide the mic button.
- Running turns are tracked in memory, per API process. With several API replicas, "running" and
  stop only see turns on the same process; an API restart drops a running turn (its question is
  saved, the answer is not).
- Backup models (AI_FALLBACK_MODELS) share the main provider and key; a different provider as
  backup is not supported yet.
