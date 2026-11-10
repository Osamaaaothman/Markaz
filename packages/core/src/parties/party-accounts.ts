import { newId } from "@erp/shared";
import type { TransactionClient } from "../contracts.js";
import { suggestNextChildCode } from "../accounting/account-code.js";
import { normalBalanceFor } from "../accounting/chart-of-accounts.service.js";
import { allocateRef } from "../reference.js";

const PARTY_KIND_MAP = {
  CUSTOMER: { key: "CUSTOMER_LEDGER_PARENT", type: "ASSET" },
  SUPPLIER: { key: "SUPPLIER_LEDGER_PARENT", type: "LIABILITY" },
} as const;

export type PartyKindWithAccount = keyof typeof PARTY_KIND_MAP;

export interface ProvisionedPartyAccount {
  readonly accountId: string;
  readonly accountCode: string;
}

// Creates one postable ledger account for a party under the mapped parent group.
// Returns null silently when no parent is mapped (i.e. the company has not opted
// into per-party ledger accounts for this kind).
export async function provisionPartyAccount(
  tx: TransactionClient,
  companyId: string,
  actorId: string,
  partyId: string,
  partyName: string,
  partyNameAr: string | null,
  kind: PartyKindWithAccount,
): Promise<ProvisionedPartyAccount | null> {
  const spec = PARTY_KIND_MAP[kind];
  const mapping = await tx.accountMapping.findFirst({
    where: { companyId, key: spec.key },
    select: { account: { select: { id: true, type: true, isPostable: true, isActive: true } } },
  });
  if (!mapping) return null;

  const parent = mapping.account;
  if (parent.isPostable || parent.type !== spec.type || !parent.isActive) return null;

  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`party-accounts:${companyId}`}))`;

  const chart = await tx.account.findMany({ where: { companyId }, select: { id: true, code: true, parentId: true } });
  const code = suggestNextChildCode(chart, parent.id);
  if (code === null) return null;

  const id = newId();
  const ref = await allocateRef(tx, companyId, "account");
  await tx.account.create({
    data: {
      id,
      ref,
      companyId,
      code,
      name: partyName,
      nameAr: partyNameAr,
      type: spec.type,
      normalBalance: normalBalanceFor(spec.type),
      isPostable: true,
      parentId: parent.id,
      partyId,
      createdBy: actorId,
    },
  });
  return { accountId: id, accountCode: code };
}
