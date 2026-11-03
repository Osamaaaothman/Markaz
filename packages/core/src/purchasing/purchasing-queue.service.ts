import type { PrismaClient } from "@erp/db";

// What each user may be told is waiting on them in purchasing. A count is returned only for the parts the caller is allowed
// to act on, so a number is never a side door around a permission (the controller decides which parts to ask for).
export interface PurchasingQueueSections {
  readonly review: boolean;
  readonly orders: boolean;
  readonly approvals: boolean;
}

export interface PurchasingQueueCounts {
  // Requests waiting for review.
  readonly requestsToReview?: number;
  // Accepted requests no one has made an order from yet.
  readonly requestsAccepted?: number;
  // Orders above the approval limit, waiting for approval.
  readonly ordersAwaitingApproval?: number;
}

export class PurchasingQueueService {
  constructor(private readonly prisma: PrismaClient) {}

  async counts(companyId: string, sections: PurchasingQueueSections): Promise<PurchasingQueueCounts> {
    const [requestsToReview, requestsAccepted, ordersAwaitingApproval] = await Promise.all([
      sections.review ? this.prisma.purchaseRequest.count({ where: { companyId, status: "PENDING" } }) : undefined,
      sections.orders ? this.prisma.purchaseRequest.count({ where: { companyId, status: "ACCEPTED" } }) : undefined,
      sections.approvals ? this.prisma.purchaseOrder.count({ where: { companyId, status: "PENDING_APPROVAL" } }) : undefined,
    ]);
    return {
      ...(requestsToReview !== undefined ? { requestsToReview } : {}),
      ...(requestsAccepted !== undefined ? { requestsAccepted } : {}),
      ...(ordersAwaitingApproval !== undefined ? { ordersAwaitingApproval } : {}),
    };
  }
}
