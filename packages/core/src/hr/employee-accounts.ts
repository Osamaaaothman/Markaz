import { newId } from "@erp/shared";
import type { TransactionClient } from "../contracts.js";
import { suggestNextChildCode } from "../accounting/account-code.js";
import { normalBalanceFor } from "../accounting/chart-of-accounts.service.js";
import { allocateRef } from "../reference.js";

// An employee's own party and three ledger accounts, created under three parent groups chosen in the account mapping.
// REVIEW: which three accounts an employee gets, their types and the parent-group design are Osama's decision (3 Nov 2026,
// "three real accounts per employee"); the account names and the fallback to company-wide accounts are mine and should be
// confirmed by an accountant.

export type EmployeeAccountKind = "advance" | "salaryPayable" | "eosb";

export class EmployeeAccountsError extends Error {
  constructor(
    readonly code: "PARENTS_INCOMPLETE" | "PARENTS_NOT_MAPPED" | "PARENT_INVALID" | "CODE_EXHAUSTED",
    message: string,
  ) {
    super(message);
    this.name = "EmployeeAccountsError";
  }
}

const KINDS: readonly {
  readonly kind: EmployeeAccountKind;
  readonly key: "EMPLOYEE_ADVANCES_PARENT" | "EMPLOYEE_SALARY_PAYABLE_PARENT" | "EMPLOYEE_EOSB_PARENT";
  readonly type: "ASSET" | "LIABILITY";
  readonly name: string;
  readonly nameAr: string;
}[] = [
  { kind: "advance", key: "EMPLOYEE_ADVANCES_PARENT", type: "ASSET", name: "Salary advance", nameAr: "سلفة" },
  { kind: "salaryPayable", key: "EMPLOYEE_SALARY_PAYABLE_PARENT", type: "LIABILITY", name: "Salary payable", nameAr: "راتب مستحق" },
  { kind: "eosb", key: "EMPLOYEE_EOSB_PARENT", type: "LIABILITY", name: "End-of-service payable", nameAr: "نهاية خدمة مستحقة" },
];

export type ParentGroups = Readonly<Record<EmployeeAccountKind, string>>;

// The three mapped parent groups. null when none is mapped (the company has not switched to per-employee accounts and
// payroll keeps using the company-wide accounts). Some but not all is a set-up mistake and is refused, so an employee never
// gets one account of the three.
export async function loadParentGroups(tx: TransactionClient, companyId: string): Promise<ParentGroups | null> {
  const mappings = await tx.accountMapping.findMany({
    where: { companyId, key: { in: KINDS.map((k) => k.key) } },
    select: { key: true, account: { select: { id: true, type: true, isPostable: true, isActive: true } } },
  });
  if (mappings.length === 0) return null;
  if (mappings.length < KINDS.length) {
    throw new EmployeeAccountsError("PARENTS_INCOMPLETE", "Only some of the three employee account groups are set in the account mapping; set all three or none");
  }
  const result: Partial<Record<EmployeeAccountKind, string>> = {};
  for (const spec of KINDS) {
    const account = mappings.find((m) => m.key === spec.key)!.account;
    if (account.isPostable || account.type !== spec.type || !account.isActive) {
      throw new EmployeeAccountsError("PARENT_INVALID", `The group set for ${spec.key} must be an active ${spec.type.toLowerCase()} group account`);
    }
    result[spec.kind] = account.id;
  }
  return result as ParentGroups;
}

export interface EmployeeAccountIds {
  readonly partyId: string;
  readonly advanceAccountId: string;
  readonly salaryPayableAccountId: string;
  readonly eosbAccountId: string;
}

export interface CreatedLedgerRecord {
  readonly entityType: "Party" | "Account";
  readonly id: string;
  readonly label: string;
}

export interface ProvisionResult {
  readonly ids: EmployeeAccountIds;
  // What this call created (not what already existed), for the audit log.
  readonly created: readonly CreatedLedgerRecord[];
}

export interface EmployeeForAccounts {
  readonly id: string;
  readonly name: string;
  readonly nameAr: string | null;
  readonly partyId: string | null;
  readonly advanceAccountId: string | null;
  readonly salaryPayableAccountId: string | null;
  readonly eosbAccountId: string | null;
}

// Creates what the employee is missing (the party, each of the three accounts) and returns all four ids. Safe to call again:
// nothing that exists is touched. A per-company advisory lock serialises code allocation, so two employees created at the
// same moment cannot be given the same account code.
export async function provisionEmployeeAccounts(
  tx: TransactionClient,
  companyId: string,
  actorId: string,
  employee: EmployeeForAccounts,
  parents: ParentGroups,
): Promise<ProvisionResult> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`employee-accounts:${companyId}`}))`;
  const created: CreatedLedgerRecord[] = [];

  let partyId = employee.partyId;
  if (partyId === null) {
    partyId = newId();
    const ref = await allocateRef(tx, companyId, "party");
    await tx.party.create({
      data: { id: partyId, ref, companyId, name: employee.name, nameAr: employee.nameAr, kind: "EMPLOYEE", createdBy: actorId, updatedBy: actorId },
    });
    created.push({ entityType: "Party", id: partyId, label: ref });
  }

  const existing: Record<EmployeeAccountKind, string | null> = {
    advance: employee.advanceAccountId,
    salaryPayable: employee.salaryPayableAccountId,
    eosb: employee.eosbAccountId,
  };
  const chart = await tx.account.findMany({ where: { companyId }, select: { id: true, code: true, parentId: true } });
  const ids: Partial<Record<EmployeeAccountKind, string>> = {};

  for (const spec of KINDS) {
    const have = existing[spec.kind];
    if (have !== null) {
      ids[spec.kind] = have;
      continue;
    }
    const parentId = parents[spec.kind];
    const code = suggestNextChildCode(chart, parentId);
    if (code === null) throw new EmployeeAccountsError("CODE_EXHAUSTED", `No free account code is left under the ${spec.key} group; add the employee's accounts by hand`);
    const id = newId();
    const ref = await allocateRef(tx, companyId, "account");
    await tx.account.create({
      data: {
        id,
        ref,
        companyId,
        code,
        name: `${spec.name} - ${employee.name}`,
        nameAr: `${spec.nameAr} - ${employee.nameAr ?? employee.name}`,
        type: spec.type,
        normalBalance: normalBalanceFor(spec.type),
        isPostable: true,
        parentId,
        partyId,
        createdBy: actorId,
      },
    });
    chart.push({ id, code, parentId });
    ids[spec.kind] = id;
    created.push({ entityType: "Account", id, label: code });
  }

  return {
    ids: { partyId, advanceAccountId: ids.advance!, salaryPayableAccountId: ids.salaryPayable!, eosbAccountId: ids.eosb! },
    created,
  };
}
