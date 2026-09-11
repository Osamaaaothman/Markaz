import { PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
import { ApprovalService, AlreadyDecidedError } from "./approval.service.js";

// docs/10-TESTING-RULES.md §1: real Postgres, not a mock — the unique-constraint
// idempotency and the state-machine transition are exactly what a mock would fake.
const hasRealDatabase = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasRealDatabase ? describe : describe.skip;

describeIfDb("ApprovalService — B6 single-step threshold engine", () => {
  const prisma = new PrismaClient();
  const service = new ApprovalService();
  let companyId: string;

  beforeAll(async () => {
    companyId = newId();
    await prisma.company.create({ data: { id: companyId, name: `Approvals Test ${companyId}` } });
    await prisma.approvalPolicy.create({
      data: { id: newId(), companyId, subjectType: "purchase_order", thresholdAmount: "5000.00", currency: "SAR" },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates no request when the amount does not cross the policy threshold", async () => {
    const result = await prisma.$transaction((tx) =>
      service.evaluateAndRequest(tx, {
        companyId,
        subjectType: "purchase_order",
        subjectId: newId(),
        amount: "100.00",
        currency: "SAR",
        requestedBy: newId(),
        correlationId: newId(),
      }),
    );
    expect(result).toBeNull();
  });

  it("creates no request for a subject type with no configured policy", async () => {
    const result = await prisma.$transaction((tx) =>
      service.evaluateAndRequest(tx, {
        companyId,
        subjectType: "journal_entry",
        subjectId: newId(),
        amount: "999999999.99",
        currency: "SAR",
        requestedBy: newId(),
        correlationId: newId(),
      }),
    );
    expect(result).toBeNull();
  });

  it("creates a PENDING request when the amount crosses the threshold, and decide() approves it", async () => {
    const subjectId = newId();
    const requested = await prisma.$transaction((tx) =>
      service.evaluateAndRequest(tx, {
        companyId,
        subjectType: "purchase_order",
        subjectId,
        amount: "12000.00",
        currency: "SAR",
        requestedBy: newId(),
        correlationId: newId(),
      }),
    );
    expect(requested?.status).toBe("PENDING");
    const requestId = requested?.id;
    if (requestId === undefined) throw new Error("expected a request id");

    const decided = await prisma.$transaction((tx) =>
      service.decide(tx, requestId, "APPROVED", newId(), new Date(), "looks fine"),
    );
    expect(decided.status).toBe("APPROVED");

    const stored = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: requestId } });
    expect(stored.decidedAt).not.toBeNull();
    expect(stored.reason).toBe("looks fine");
  });

  it("re-evaluating the same subject returns the existing live request instead of a duplicate", async () => {
    const subjectId = newId();
    const first = await prisma.$transaction((tx) =>
      service.evaluateAndRequest(tx, {
        companyId,
        subjectType: "purchase_order",
        subjectId,
        amount: "9000.00",
        currency: "SAR",
        requestedBy: newId(),
        correlationId: newId(),
      }),
    );
    const second = await prisma.$transaction((tx) =>
      service.evaluateAndRequest(tx, {
        companyId,
        subjectType: "purchase_order",
        subjectId,
        amount: "9000.00",
        currency: "SAR",
        requestedBy: newId(),
        correlationId: newId(),
      }),
    );
    expect(second?.id).toBe(first?.id);

    const all = await prisma.approvalRequest.findMany({ where: { companyId, subjectType: "purchase_order", subjectId } });
    expect(all).toHaveLength(1);
  });

  it("refuses to decide an already-decided request — a decision is terminal", async () => {
    const subjectId = newId();
    const requested = await prisma.$transaction((tx) =>
      service.evaluateAndRequest(tx, {
        companyId,
        subjectType: "purchase_order",
        subjectId,
        amount: "8000.00",
        currency: "SAR",
        requestedBy: newId(),
        correlationId: newId(),
      }),
    );
    const requestId = requested?.id;
    if (requestId === undefined) throw new Error("expected a request id");

    await prisma.$transaction((tx) => service.decide(tx, requestId, "REJECTED", newId(), new Date()));

    await expect(prisma.$transaction((tx) => service.decide(tx, requestId, "APPROVED", newId(), new Date()))).rejects.toThrow(
      AlreadyDecidedError,
    );
  });
});
