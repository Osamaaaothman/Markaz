import { Prisma, type PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
import type { IAuditLogger } from "../contracts.js";

// The document types that can be put behind an approval threshold. Core does not know which modules
// exist, so the list is held where a module opts in — today only purchase orders.
export const APPROVABLE_SUBJECT_TYPES = ["purchase_order"] as const;
export type ApprovableSubjectType = (typeof APPROVABLE_SUBJECT_TYPES)[number];

export class ApprovalPolicyError extends Error {
  constructor(
    readonly code: "INVALID_THRESHOLD",
    message: string,
  ) {
    super(message);
    this.name = "ApprovalPolicyError";
  }
}

export interface ApprovalPolicyEntry {
  readonly subjectType: ApprovableSubjectType;
  // null = no policy: this document type never waits for approval.
  readonly thresholdAmount: string | null;
  readonly currency: string;
}

export interface ApprovalPolicyActor {
  readonly id: string;
  readonly companyId: string;
}

// The settings side of the approval engine: which document types need approval above what amount.
// Amounts are in the company currency. Removing a policy never touches requests already made.
export class ApprovalPolicyService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: IAuditLogger,
  ) {}

  async list(companyId: string): Promise<ApprovalPolicyEntry[]> {
    const [company, policies] = await Promise.all([
      this.prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { defaultCurrency: true } }),
      this.prisma.approvalPolicy.findMany({ where: { companyId } }),
    ]);
    const bySubject = new Map(policies.map((p) => [p.subjectType, p]));
    return APPROVABLE_SUBJECT_TYPES.map((subjectType) => {
      const policy = bySubject.get(subjectType);
      return {
        subjectType,
        thresholdAmount: policy ? policy.thresholdAmount.toFixed(4) : null,
        currency: policy?.currency ?? company.defaultCurrency,
      };
    });
  }

  // `thresholdAmount === null` removes the policy.
  async set(
    subjectType: ApprovableSubjectType,
    thresholdAmount: string | null,
    actor: ApprovalPolicyActor,
    correlationId: string,
  ): Promise<ApprovalPolicyEntry> {
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: actor.companyId }, select: { defaultCurrency: true } });
    const before = (await this.list(actor.companyId)).find((p) => p.subjectType === subjectType);

    if (thresholdAmount === null) {
      await this.prisma.approvalPolicy.deleteMany({ where: { companyId: actor.companyId, subjectType } });
    } else {
      const amount = new Prisma.Decimal(thresholdAmount);
      if (amount.lessThan(0)) throw new ApprovalPolicyError("INVALID_THRESHOLD", "The threshold cannot be negative");
      await this.prisma.approvalPolicy.upsert({
        where: { companyId_subjectType: { companyId: actor.companyId, subjectType } },
        create: { id: newId(), companyId: actor.companyId, subjectType, thresholdAmount: amount, currency: company.defaultCurrency },
        update: { thresholdAmount: amount, currency: company.defaultCurrency },
      });
    }

    const after: ApprovalPolicyEntry = {
      subjectType,
      thresholdAmount: thresholdAmount === null ? null : new Prisma.Decimal(thresholdAmount).toFixed(4),
      currency: company.defaultCurrency,
    };
    await this.audit.log({
      actorId: actor.id,
      action: "approval_policy.updated",
      entityType: "ApprovalPolicy",
      entityId: subjectType,
      ...(before ? { before: { ...before } } : {}),
      after: { ...after },
      correlationId,
    });
    return after;
  }
}
