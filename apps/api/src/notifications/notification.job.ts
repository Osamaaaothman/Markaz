import type { Job, Processor } from "bullmq";
import type { OutboxJobData } from "../jobs/outbox-relay.js";
import type { EmailTransport } from "./email-transport.js";
import { renderGenericNotice, type GenericNoticeParams } from "./notification-templates.js";
import {
  SUPPORTED_DOCUMENT_LANGUAGES,
  type SupportedDocumentLanguage,
} from "../i18n/server-i18n.js";

// Notifications are ALWAYS sent via the outbox (packages/core/src/outbox), never
// enqueued directly — this queue's name IS the outbox topic a caller writes
// (writeOutboxMessage(tx, { topic: NOTIFICATIONS_QUEUE, payload: {...} })), inside
// the same transaction as whatever business event triggered it. That is what
// gives "the email survives a crash right after commit" instead of a bare
// queue.add() that a mid-request crash could lose.
export const NOTIFICATIONS_QUEUE = "notifications";

export interface NotificationPayload {
  readonly to: string;
  readonly language: SupportedDocumentLanguage;
  readonly recipientName: string;
  readonly companyName: string;
  readonly message: string;
}

class InvalidNotificationPayloadError extends Error {
  constructor(reason: string) {
    super(`Invalid notification payload: ${reason}`);
    this.name = "InvalidNotificationPayloadError";
  }
}

// The payload crossed a DB JSON column (outbox_messages.payload) — validated here
// rather than cast, the same reason any other untyped-at-rest boundary gets a
// guard (docs/07-API-RULES.md §... "validate everything at the boundary").
function parseNotificationPayload(payload: unknown): NotificationPayload {
  if (typeof payload !== "object" || payload === null) {
    throw new InvalidNotificationPayloadError("payload is not an object");
  }
  const p = payload as Record<string, unknown>;
  if (typeof p.to !== "string" || p.to.length === 0) {
    throw new InvalidNotificationPayloadError("`to` must be a non-empty string");
  }
  if (
    typeof p.language !== "string" ||
    !SUPPORTED_DOCUMENT_LANGUAGES.includes(p.language as never)
  ) {
    throw new InvalidNotificationPayloadError(
      `\`language\` must be one of ${SUPPORTED_DOCUMENT_LANGUAGES.join(", ")}`,
    );
  }
  if (typeof p.recipientName !== "string") {
    throw new InvalidNotificationPayloadError("`recipientName` must be a string");
  }
  if (typeof p.companyName !== "string") {
    throw new InvalidNotificationPayloadError("`companyName` must be a string");
  }
  if (typeof p.message !== "string") {
    throw new InvalidNotificationPayloadError("`message` must be a string");
  }
  return {
    to: p.to,
    language: p.language as SupportedDocumentLanguage,
    recipientName: p.recipientName,
    companyName: p.companyName,
    message: p.message,
  };
}

// docs/02-ARCHITECTURE-RULES.md §6: "Email / PDF generation" belongs in a job, not
// the HTTP request. Rendering + sending both happen inside this one job so a
// transient SMTP failure retries the whole thing — idempotent in the sense that
// re-sending a notification email on retry is an accepted, documented tradeoff
// (never a business record, unlike a ZATCA submission or a journal entry).
export function createNotificationProcessor(transport: EmailTransport): Processor<OutboxJobData> {
  return async (job: Job<OutboxJobData>): Promise<void> => {
    const payload = parseNotificationPayload(job.data.payload);
    const params: GenericNoticeParams = {
      language: payload.language,
      to: payload.to,
      recipientName: payload.recipientName,
      companyName: payload.companyName,
      message: payload.message,
    };
    const email = await renderGenericNotice(params);
    await transport.send(email);
  };
}
