import type { TransactionClient } from "../contracts.js";

export interface PaymentCashAccount {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly nameAr: string | null;
}

// Follow configured folders, not account names or code prefixes. Nested bank folders are supported.
export async function paymentCashAccounts(db: TransactionClient, companyId: string, method: string): Promise<PaymentCashAccount[]> {
  const key = method === "CASH" ? "CASH_ACCOUNTS_PARENT" : "BANK_ACCOUNTS_PARENT";
  return db.$queryRaw<PaymentCashAccount[]>`
    WITH RECURSIVE eligible AS (
      SELECT a.id, a.code, a.name, a.name_ar, a.is_postable
      FROM accounts a JOIN account_mappings m ON m.account_id = a.id AND m.company_id = a.company_id
      WHERE m.company_id = ${companyId} AND m.key = ${key} AND a.type = 'ASSET' AND a.is_active
        AND NOT EXISTS (
          SELECT 1 FROM account_mappings other WHERE other.company_id = ${companyId}
            AND other.account_id = a.id AND other.key IN ('CASH_ACCOUNTS_PARENT', 'BANK_ACCOUNTS_PARENT') AND other.key <> ${key}
        )
      UNION
      SELECT a.id, a.code, a.name, a.name_ar, a.is_postable
      FROM accounts a JOIN eligible parent ON a.parent_id = parent.id
      WHERE a.company_id = ${companyId} AND a.type = 'ASSET' AND a.is_active
        AND NOT EXISTS (
          SELECT 1 FROM account_mappings other
          WHERE other.company_id = ${companyId} AND other.account_id = a.id
            AND other.key IN ('CASH_ACCOUNTS_PARENT', 'BANK_ACCOUNTS_PARENT') AND other.key <> ${key}
        )
    ) SELECT id, code, name, name_ar AS "nameAr" FROM eligible WHERE is_postable ORDER BY code
  `;
}
