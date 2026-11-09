import { createHash } from "node:crypto";
import { PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
import { EgsChainError, EgsChainService, FIRST_INVOICE_PREVIOUS_HASH } from "./egs-chain.service.js";

// Real PostgreSQL (docs/10-TESTING-RULES.md §1); skipped without DATABASE_URL.
const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

// A stand-in for "build and hash the invoice" (Phase 3/4, not built yet): deterministic so the
// test can recompute and check the chain, not a claim about the real ZATCA hash algorithm.
const fakeInvoiceHash = (icv: bigint, previousInvoiceHash: string): string => createHash("sha256").update(`${icv.toString()}:${previousInvoiceHash}`).digest("base64");

describeIfDb("EGS ICV/PIH chain — real database", () => {
  const prisma = new PrismaClient();
  const chain = new EgsChainService();
  const companyId = newId();
  let egsUnitId: string;
  let firstInvoiceHash: string;

  beforeAll(async () => {
    await prisma.company.create({ data: { id: companyId, name: `Chain Test ${companyId}`, defaultCurrency: "SAR" } });
    const egsUnit = await prisma.egsUnit.create({
      data: {
        id: newId(),
        companyId,
        name: "Till 1",
        serial: `1-MarkazPOS|2-M1|3-${companyId.slice(0, 8)}`,
        businessCategory: "Retail",
        invoiceTypes: "1100",
        environment: "sandbox",
      },
    });
    egsUnitId = egsUnit.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("refuses peekNext before the EGS has been onboarded (no chain state yet)", async () => {
    const neverOnboarded = (await prisma.egsUnit.create({
      data: {
        id: newId(),
        companyId,
        name: "Never onboarded",
        serial: `1-MarkazPOS|2-M1|3-${newId()}`,
        businessCategory: "Retail",
        invoiceTypes: "1100",
        environment: "sandbox",
      },
    })).id;
    await expect(prisma.$transaction((tx) => chain.peekNext(tx, neverOnboarded))).rejects.toBeInstanceOf(EgsChainError);
  });

  it("starts the first invoice's previous-invoice-hash at base64(SHA-256(\"0\")), then advances", async () => {
    await prisma.$transaction((tx) => chain.createFor(tx, companyId, egsUnitId));
    firstInvoiceHash = await prisma.$transaction(async (tx) => {
      const next = await chain.peekNext(tx, egsUnitId);
      expect(next.icv).toBe(1n);
      expect(next.previousInvoiceHash).toBe(FIRST_INVOICE_PREVIOUS_HASH);
      const hash = fakeInvoiceHash(next.icv, next.previousInvoiceHash);
      await chain.advance(tx, egsUnitId, next.icv, hash);
      return hash;
    });

    const state = await prisma.egsChainState.findUniqueOrThrow({ where: { egsUnitId } });
    expect(state.lastIcv).toBe(1n);
    expect(state.lastInvoiceHash).toBe(firstInvoiceHash);
  });

  it("chains sequentially: each invoice's PIH is exactly the previous invoice's hash", async () => {
    const hashes: string[] = [firstInvoiceHash]; // seeded with the previous test's committed hash (icv=1)
    for (let i = 0; i < 5; i++) {
      await prisma.$transaction(async (tx) => {
        const next = await chain.peekNext(tx, egsUnitId);
        expect(next.icv).toBe(BigInt(i + 2)); // continuing from the previous test's icv=1
        expect(next.previousInvoiceHash).toBe(hashes[i]);
        const hash = fakeInvoiceHash(next.icv, next.previousInvoiceHash);
        hashes.push(hash);
        await chain.advance(tx, egsUnitId, next.icv, hash);
      });
    }

    const state = await prisma.egsChainState.findUniqueOrThrow({ where: { egsUnitId } });
    expect(state.lastIcv).toBe(6n);
    expect(state.lastInvoiceHash).toBe(hashes[hashes.length - 1]);
  });

  it("refuses advance() called with the wrong expected ICV (lock discipline broken)", async () => {
    await expect(prisma.$transaction((tx) => chain.advance(tx, egsUnitId, 999n, "whatever"))).rejects.toBeInstanceOf(EgsChainError);
  });

  it("holds the row lock under 20 concurrent invoices: no duplicate ICV, no duplicate PIH, and the chain still ties together", async () => {
    const concurrent = (await prisma.egsUnit.create({
      data: {
        id: newId(),
        companyId,
        name: "Concurrency till",
        serial: `1-MarkazPOS|2-M1|3-${newId()}`,
        businessCategory: "Retail",
        invoiceTypes: "1100",
        environment: "sandbox",
      },
    })).id;
    await prisma.$transaction((tx) => chain.createFor(tx, companyId, concurrent));

    const N = 20;
    const used = await Promise.all(
      Array.from({ length: N }, () =>
        prisma.$transaction(async (tx) => {
          const next = await chain.peekNext(tx, concurrent);
          const hash = fakeInvoiceHash(next.icv, next.previousInvoiceHash);
          await chain.advance(tx, concurrent, next.icv, hash);
          return { icv: next.icv, previousInvoiceHash: next.previousInvoiceHash, hash };
        }),
      ),
    );

    // No two invoices got the same ICV, and no two got the same PIH.
    const icvs = used.map((u) => u.icv.toString());
    const pihs = used.map((u) => u.previousInvoiceHash);
    expect(new Set(icvs).size).toBe(N);
    expect(new Set(pihs).size).toBe(N);

    // The ICVs used are exactly 1..N (gapless), and sorted by ICV the chain ties together:
    // invoice k's PIH is exactly invoice (k-1)'s hash.
    const byIcv = [...used].sort((a, b) => Number(a.icv - b.icv));
    expect(byIcv.map((u) => u.icv.toString())).toEqual(Array.from({ length: N }, (_, i) => String(i + 1)));
    expect(byIcv[0]!.previousInvoiceHash).toBe(FIRST_INVOICE_PREVIOUS_HASH);
    for (let i = 1; i < byIcv.length; i++) {
      expect(byIcv[i]!.previousInvoiceHash).toBe(byIcv[i - 1]!.hash);
    }

    const state = await prisma.egsChainState.findUniqueOrThrow({ where: { egsUnitId: concurrent } });
    expect(state.lastIcv).toBe(BigInt(N));
    expect(state.lastInvoiceHash).toBe(byIcv[byIcv.length - 1]!.hash);
  });
});
