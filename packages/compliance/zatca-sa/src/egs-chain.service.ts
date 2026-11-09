// The ICV/PIH chain for one EGS unit — docs/06-COMPLIANCE-PACK-RULES.md §3: the two numbers
// that make the invoice hash chain tamper-evident. Every invoice this EGS issues must get a
// strictly sequential ICV and the exact previous invoice's hash as its PIH; two invoices must
// never receive the same ICV or the same PIH (docs/02-ARCHITECTURE-RULES.md §5 — this is a
// "reads-then-writes a sequence" case that needs a lock, same discipline as
// PrismaNumberingService.next).
//
// Usage: inside the same database transaction that will build and post the invoice —
//   1. `peekNext` — row-locks the chain state and returns the ICV/PIH this invoice must use.
//   2. build the invoice XML and hash it (Phase 3/4) using those values.
//   3. `advance` — writes the chain forward to what was just used.
// The lock taken in step 1 is held until the transaction commits or rolls back, so no other
// invoice for this EGS can be assigned the same values while this one is in flight.
import { createHash } from "node:crypto";
import type { PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";

// The subset of PrismaClient usable inside an interactive transaction — mirrors
// packages/core/src/contracts.ts TransactionClient. Not imported from there: this package
// depends only on @erp/db and @erp/shared (docs/02-ARCHITECTURE-RULES.md §1).
export type TransactionClient = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;

export class EgsChainError extends Error {
  constructor(
    readonly code: "CHAIN_STATE_NOT_FOUND" | "ICV_MISMATCH",
    message: string,
  ) {
    super(message);
    this.name = "EgsChainError";
  }
}

export interface NextChainValue {
  readonly icv: bigint;
  readonly previousInvoiceHash: string;
}

// Verified against the official SDK's own Data/PIH/pih.txt (zatca-einvoicing-sdk-238-R3.4.8):
// NOT base64 of the raw 32-byte SHA-256 digest (the task spec's starting assumption, which this
// constant used to compute and which was WRONG). It is base64 of the digest's *hex-string*
// representation — hash first, render as 64 lowercase hex characters, then base64 THAT text.
// This double-encoding is specific to how the previous-invoice-hash is carried as plain text in
// the XML; it does not necessarily apply to other hash usages (e.g. the QR code's tag-6 "XML
// Hash" field is specified as exactly 32 bytes, i.e. the raw digest, not this 44-byte form —
// check each usage against its own spec section in Phase 4, don't assume they match).
export const FIRST_INVOICE_PREVIOUS_HASH: string = Buffer.from(createHash("sha256").update("0").digest("hex"), "utf8").toString("base64");

interface ChainStateRow {
  readonly last_icv: bigint;
  readonly last_invoice_hash: string | null;
}

export class EgsChainService {
  // Creates the chain-state row for a newly onboarded EGS unit. Call once, inside the same
  // transaction that creates the EgsUnit row — this service never creates an EgsUnit itself
  // (that is Phase 2's onboarding flow).
  async createFor(tx: TransactionClient, companyId: string, egsUnitId: string): Promise<void> {
    await tx.egsChainState.create({
      data: { id: newId(), companyId, egsUnitId, lastIcv: 0n, lastInvoiceHash: null },
    });
  }

  async peekNext(tx: TransactionClient, egsUnitId: string): Promise<NextChainValue> {
    const rows = await tx.$queryRaw<ChainStateRow[]>`
      SELECT last_icv, last_invoice_hash FROM egs_chain_states WHERE egs_unit_id = ${egsUnitId} FOR UPDATE
    `;
    const row = rows[0];
    if (!row) {
      throw new EgsChainError("CHAIN_STATE_NOT_FOUND", "No chain state for this EGS unit — was it onboarded?");
    }
    return {
      icv: row.last_icv + 1n,
      previousInvoiceHash: row.last_invoice_hash ?? FIRST_INVOICE_PREVIOUS_HASH,
    };
  }

  // `icv` and `invoiceHash` must be the values the invoice just built actually used. The
  // WHERE clause re-checks last_icv so a caller that calls `advance` without having held
  // `peekNext`'s lock across both (a bug) fails loudly instead of silently corrupting the chain.
  async advance(tx: TransactionClient, egsUnitId: string, icv: bigint, invoiceHash: string): Promise<void> {
    const affected = await tx.$executeRaw`
      UPDATE egs_chain_states SET last_icv = ${icv}, last_invoice_hash = ${invoiceHash}, updated_at = now()
      WHERE egs_unit_id = ${egsUnitId} AND last_icv = ${icv - 1n}
    `;
    if (affected === 0) {
      throw new EgsChainError(
        "ICV_MISMATCH",
        `Expected to advance EGS ${egsUnitId} from ICV ${(icv - 1n).toString()} to ${icv.toString()}, but the stored value had already moved — peekNext and advance must run inside the same locked transaction.`,
      );
    }
  }
}
