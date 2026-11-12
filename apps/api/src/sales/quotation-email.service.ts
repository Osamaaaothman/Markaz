import type { PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
import { PrismaAuditLogger } from "@erp/core";
import {
  EmailDeliveryError,
  redactAddress,
  type EmailMessage,
  type EmailTransport,
} from "../notifications/email-transport.js";

export class QuotationEmailError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly attemptId?: string,
  ) {
    super(code);
  }
}
export class QuotationEmailService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly transport: EmailTransport,
  ) {}

  async history(companyId: string, quotationId: string, cursor?: string) {
    if (
      !(await this.prisma.quotation.findFirst({
        where: { id: quotationId, companyId },
        select: { id: true },
      }))
    )
      throw new QuotationEmailError(404, "EMAIL_NOT_FOUND");
    const rows = await this.prisma.quotationEmailAttempt.findMany({
      where: { companyId, quotationId },
      orderBy: { id: "desc" },
      take: 21,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        recipient: true,
        language: true,
        subject: true,
        status: true,
        createdAt: true,
        sentAt: true,
        checkedAt: true,
        errorCode: true,
        provider: true,
      },
    });
    return {
      data: rows.slice(0, 20),
      pageInfo: { hasMore: rows.length > 20, nextCursor: rows.length > 20 ? rows[19]!.id : null },
    };
  }

  async send(
    quotationId: string,
    input: { to: string; language: string },
    actor: { id: string; companyId: string },
    correlationId: string,
    requestKey: string,
    prepare: () => Promise<EmailMessage>,
  ) {
    const id = newId();
    const attempt = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${actor.companyId}:quotation-email:${requestKey}`}, 0))`;
      if (
        !(await tx.quotation.findFirst({
          where: { id: quotationId, companyId: actor.companyId },
          select: { id: true },
        }))
      )
        throw new QuotationEmailError(404, "EMAIL_NOT_FOUND");
      const previous = await tx.quotationEmailAttempt.findUnique({
        where: { companyId_requestKey: { companyId: actor.companyId, requestKey } },
      });
      if (previous) {
        if (
          previous.quotationId !== quotationId ||
          previous.recipient !== input.to ||
          previous.language !== input.language
        )
          throw new QuotationEmailError(409, "IDEMPOTENCY_CONFLICT");
        return previous;
      }
      const row = await tx.quotationEmailAttempt.create({
        data: {
          id,
          companyId: actor.companyId,
          quotationId,
          recipient: input.to,
          language: input.language,
          status: "SENDING",
          requestKey,
          createdBy: actor.id,
          updatedBy: actor.id,
        },
      });
      await new PrismaAuditLogger(tx).log({
        actorId: actor.id,
        action: "quotation.email_requested",
        entityType: "Quotation",
        entityId: quotationId,
        after: { attemptId: id, to: redactAddress(input.to) },
        correlationId,
      });
      return row;
    });
    if (attempt.id !== id) {
      if (["ACCEPTED", "DELIVERED"].includes(attempt.status))
        return {
          sentAt: attempt.sentAt?.toISOString() ?? attempt.createdAt.toISOString(),
          attemptId: attempt.id,
        };
      throw new QuotationEmailError(409, "EMAIL_ATTEMPT_EXISTS", attempt.id);
    }
    let providerStarted = false;
    try {
      if (this.transport.configured === false) throw new EmailDeliveryError("EMAIL_NOT_CONFIGURED");
      const message = await prepare();
      await this.prisma.quotationEmailAttempt.update({
        where: { id },
        data: { subject: message.subject },
      });
      providerStarted = true;
      const receipt = await this.transport.send({ ...message, idempotencyKey: id });
      const sentAt = new Date();
      await this.prisma.$transaction(async (tx) => {
        await tx.quotationEmailAttempt.update({
          where: { id },
          data: {
            status: "ACCEPTED",
            sentAt,
            provider: receipt?.provider ?? "smtp",
            providerId: receipt?.id ?? null,
            version: { increment: 1 },
          },
        });
        await new PrismaAuditLogger(tx).log({
          actorId: actor.id,
          action: "quotation.email_accepted",
          entityType: "Quotation",
          entityId: quotationId,
          after: { attemptId: id },
          correlationId,
        });
      });
      return { sentAt: sentAt.toISOString(), attemptId: id };
    } catch (error) {
      const code = error instanceof EmailDeliveryError ? error.code : "EMAIL_DELIVERY_FAILED";
      const knownFailure =
        error instanceof EmailDeliveryError && error.code !== "EMAIL_DELIVERY_UNCERTAIN";
      const status = !providerStarted || knownFailure ? "FAILED" : "UNKNOWN";
      await this.prisma.$transaction(async (tx) => {
        await tx.quotationEmailAttempt.update({
          where: { id },
          data: { status, errorCode: code, version: { increment: 1 } },
        });
        await new PrismaAuditLogger(tx).log({
          actorId: actor.id,
          action: "quotation.email_failed",
          entityType: "Quotation",
          entityId: quotationId,
          after: { attemptId: id, status, code },
          correlationId,
        });
      });
      throw new QuotationEmailError(503, code, id);
    }
  }

  async refresh(
    companyId: string,
    quotationId: string,
    id: string,
    actorId: string,
    correlationId: string,
  ) {
    const row = await this.prisma.quotationEmailAttempt.findFirst({
      where: { id, companyId, quotationId },
    });
    if (!row) throw new QuotationEmailError(404, "EMAIL_NOT_FOUND");
    if (row.provider !== "resend" || !row.providerId || !this.transport.deliveryStatus)
      return { status: row.status, trackingAvailable: false };
    const observed = await this.transport.deliveryStatus(row.providerId);
    if (!observed) throw new QuotationEmailError(503, "EMAIL_STATUS_UNAVAILABLE");
    const status = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT id FROM quotation_email_attempts WHERE id = ${id} AND company_id = ${companyId} FOR UPDATE`;
      const current = await tx.quotationEmailAttempt.findUniqueOrThrow({ where: { id } });
      // Preserve terminal evidence even when concurrent status requests arrive out of order.
      const terminal = ["FAILED", "BOUNCED", "COMPLAINED"];
      const next =
        terminal.includes(current.status) ||
        (current.status === "DELIVERED" && ["ACCEPTED", "DELAYED"].includes(observed))
          ? current.status
          : observed;
      await tx.quotationEmailAttempt.update({
        where: { id },
        data: {
          status: next,
          checkedAt: new Date(),
          updatedBy: actorId,
          version: { increment: 1 },
        },
      });
      await new PrismaAuditLogger(tx).log({
        actorId,
        action: "quotation.email_status_checked",
        entityType: "Quotation",
        entityId: quotationId,
        after: { attemptId: id, status: next },
        correlationId,
      });
      return next;
    });
    return { status, trackingAvailable: true };
  }
}
