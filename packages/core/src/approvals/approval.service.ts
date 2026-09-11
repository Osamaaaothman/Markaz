import { Money, newId } from "@erp/shared";
import type { TransactionClient } from "../contracts.js";
import { requiresApproval, type ApprovalPolicyConfig } from "./approval-policy.js";

export interface RequestApprovalInput {
  readonly companyId: string;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly amount: string;
  readonly currency: string;
  readonly requestedBy: string;
  readonly correlationId: string;
}

export type ApprovalDecision = "APPROVED" | "REJECTED";

export interface ApprovalRequestResult {
  readonly id: string;
  readonly status: "PENDING" | ApprovalDecision;
}

export class AlreadyDecidedError extends Error {
  constructor(requestId: string, status: string) {
    super(`Approval request ${requestId} was already ${status} and cannot be decided again`);
    this.name = "AlreadyDecidedError";
  }
}

// docs/01-OPEN-DECISIONS.md B6 (Tier 1: single-step amount threshold). Not one of
// the five mandatory Core contracts (docs/02-ARCHITECTURE-RULES.md §3) — this is
// shared platform infrastructure a future module opts into, the same way
// packages/core/src/outbox is, not a rule every module must go through.
//
// No HTTP surface exists for this yet — there is no real caller until a module
// with approvable documents exists (Purchasing, M5). Deliberately not building a
// controller/DTO layer speculating about that shape now (CLAUDE.md §7).
export class ApprovalService {
  async getPolicy(
    tx: TransactionClient,
    companyId: string,
    subjectType: string,
  ): Promise<ApprovalPolicyConfig | null> {
    const policy = await tx.approvalPolicy.findUnique({
      where: { companyId_subjectType: { companyId, subjectType } },
    });
    if (policy === null) {
      return null;
    }
    return { thresholdAmount: policy.thresholdAmount.toString(), currency: policy.currency };
  }

  // Returns null when the amount does not cross this company's policy for this
  // subject type — the caller's document proceeds with no approval step at all.
  // Idempotent per (companyId, subjectType, subjectId): re-evaluating the same
  // document returns the existing live request rather than creating a duplicate —
  // callers should pass the SAME transaction they use to create/update the
  // underlying document, the same convention as writeOutboxMessage.
  async evaluateAndRequest(
    tx: TransactionClient,
    input: RequestApprovalInput,
  ): Promise<ApprovalRequestResult | null> {
    const policy = await this.getPolicy(tx, input.companyId, input.subjectType);
    const amount = Money.of(input.amount, input.currency);
    if (!requiresApproval(amount, policy)) {
      return null;
    }

    const existing = await tx.approvalRequest.findUnique({
      where: {
        companyId_subjectType_subjectId: {
          companyId: input.companyId,
          subjectType: input.subjectType,
          subjectId: input.subjectId,
        },
      },
    });
    if (existing !== null) {
      return { id: existing.id, status: existing.status };
    }

    const created = await tx.approvalRequest.create({
      data: {
        id: newId(),
        companyId: input.companyId,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        amount: input.amount,
        currency: input.currency,
        requestedBy: input.requestedBy,
        correlationId: input.correlationId,
      },
    });
    return { id: created.id, status: created.status };
  }

  // docs/09-SECURITY-RULES.md §3: "Checked in the application layer for every use
  // case" — WHO may decide a given subject type's approvals is a permission the
  // calling module/controller enforces (it varies per module); this only enforces
  // the state machine itself — a decision is terminal, never re-decided.
  async decide(
    tx: TransactionClient,
    requestId: string,
    decision: ApprovalDecision,
    decidedBy: string,
    now: Date,
    reason?: string,
  ): Promise<ApprovalRequestResult> {
    const request = await tx.approvalRequest.findUniqueOrThrow({ where: { id: requestId } });
    if (request.status !== "PENDING") {
      throw new AlreadyDecidedError(requestId, request.status);
    }
    const updated = await tx.approvalRequest.update({
      where: { id: requestId },
      data: {
        status: decision,
        decidedBy,
        decidedAt: now,
        ...(reason !== undefined ? { reason } : {}),
      },
    });
    return { id: updated.id, status: updated.status };
  }
}
