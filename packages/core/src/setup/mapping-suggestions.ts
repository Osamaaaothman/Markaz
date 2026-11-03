import type { PrismaClient } from "@erp/db";
import { suggestNextChildCode } from "../accounting/account-code.js";
import { ChartOfAccountsService, type AccountType } from "../accounting/chart-of-accounts.service.js";
import { ACCOUNT_MAPPING_KEYS, AccountMappingService, GROUP_MAPPING_KEYS, type AccountMappingKey } from "../inventory/account-mapping.service.js";

// Suggested account mappings for a company that uses the standard chart this product seeds. REVIEW: every row below is MY reading of
// the seeded chart's names, not an accounting ruling; each is only a proposal shown to the user, who confirms it, and a company's
// accountant should check them before the first real posting. Nothing is applied without that confirmation.
//
// The seeded chart is mostly folders (group accounts) with no postable account inside, so most suggestions say "create this account
// under that folder, then map it". Keys without a sensible folder in the chart (cost of goods sold, price variance, project issue
// expense, count loss/gain, GOSI employer expense, end-of-service expense) have no suggestion on purpose: they are for the accountant.

interface Rule {
  // MAP_EXISTING: map the postable account with this code. MAP_FOLDER: map this folder (the three per-employee keys).
  // CREATE_UNDER: create a postable account named so under the folder with this code, then map it.
  readonly action: "MAP_EXISTING" | "MAP_FOLDER" | "CREATE_UNDER";
  readonly code: string;
  readonly name?: string;
  readonly nameAr?: string;
}

const RULES: Readonly<Partial<Record<AccountMappingKey, Rule>>> = {
  INVENTORY: { action: "CREATE_UNDER", code: "1110801", name: "Inventory", nameAr: "مخزون البضاعة" },
  GRNI: { action: "MAP_EXISTING", code: "2110602" },
  ACCOUNTS_PAYABLE: { action: "CREATE_UNDER", code: "2110601", name: "Accounts payable", nameAr: "الموردون" },
  VAT_INPUT: { action: "MAP_EXISTING", code: "1111701" },
  ACCOUNTS_RECEIVABLE: { action: "CREATE_UNDER", code: "1110901", name: "Accounts receivable", nameAr: "العملاء" },
  SALES_REVENUE: { action: "MAP_EXISTING", code: "4110301" },
  VAT_OUTPUT: { action: "CREATE_UNDER", code: "2111010", name: "VAT output", nameAr: "ضريبة القيمة المضافة - مخرجات" },
  SALARY_EXPENSE: { action: "CREATE_UNDER", code: "6110101", name: "Salaries expense", nameAr: "مصروف الرواتب" },
  NET_PAY_PAYABLE: { action: "CREATE_UNDER", code: "2111101", name: "Net salaries payable", nameAr: "صافي الرواتب المستحقة" },
  GOSI_PAYABLE: { action: "CREATE_UNDER", code: "2110901", name: "Social insurance payable", nameAr: "التأمينات الاجتماعية المستحقة" },
  SALARY_ADVANCES_RECEIVABLE: { action: "CREATE_UNDER", code: "1111201", name: "Employee advances", nameAr: "سلف الموظفين" },
  EOSB_PAYABLE: { action: "CREATE_UNDER", code: "2210201", name: "End-of-service payable", nameAr: "مكافأة نهاية الخدمة المستحقة" },
  EMPLOYEE_ADVANCES_PARENT: { action: "MAP_FOLDER", code: "1111201" },
  EMPLOYEE_SALARY_PAYABLE_PARENT: { action: "MAP_FOLDER", code: "2111101" },
  EMPLOYEE_EOSB_PARENT: { action: "MAP_FOLDER", code: "2111102" },
};

export interface MappingSuggestion {
  readonly key: AccountMappingKey;
  readonly action: Rule["action"];
  readonly folderCode: string;
  readonly folderName: string;
  readonly folderNameAr: string | null;
  // The account that will be mapped: an existing one, or the one that will be created (code and names).
  readonly accountCode: string;
  readonly accountName: string;
  readonly accountNameAr: string | null;
}

export interface ApplySuggestionResult {
  readonly key: AccountMappingKey;
  readonly status: "APPLIED" | "SKIPPED";
  readonly reason?: string;
}

export interface SuggestionActor {
  readonly id: string;
  readonly companyId: string;
}

export class MappingSuggestionService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly mappings: AccountMappingService,
    private readonly chart: ChartOfAccountsService,
  ) {}

  // The proposals for the keys this company has not mapped yet and whose folder or account exists in its chart.
  async suggestions(companyId: string): Promise<readonly MappingSuggestion[]> {
    const mapped = new Set((await this.prisma.accountMapping.findMany({ where: { companyId }, select: { key: true } })).map((m) => m.key));
    const accounts = await this.prisma.account.findMany({ where: { companyId }, select: { id: true, code: true, name: true, nameAr: true, type: true, isPostable: true, isActive: true, parentId: true } });
    const byCode = new Map(accounts.map((a) => [a.code, a]));
    const out: MappingSuggestion[] = [];
    for (const key of ACCOUNT_MAPPING_KEYS) {
      const rule = RULES[key];
      if (!rule || mapped.has(key)) continue;
      const target = byCode.get(rule.code);
      if (!target || !target.isActive) continue;
      if (rule.action === "MAP_EXISTING" && !target.isPostable) continue;
      if (rule.action !== "MAP_EXISTING" && target.isPostable) continue;
      if (rule.action === "MAP_FOLDER" && GROUP_MAPPING_KEYS[key] !== target.type) continue;
      if (rule.action === "CREATE_UNDER") {
        const code = suggestNextChildCode(accounts, target.id);
        if (code === null) continue;
        out.push({ key, action: rule.action, folderCode: target.code, folderName: target.name, folderNameAr: target.nameAr, accountCode: code, accountName: rule.name!, accountNameAr: rule.nameAr ?? null });
      } else {
        out.push({ key, action: rule.action, folderCode: target.code, folderName: target.name, folderNameAr: target.nameAr, accountCode: target.code, accountName: target.name, accountNameAr: target.nameAr });
      }
    }
    return out;
  }

  // Applies the chosen proposals one by one (each is its own transaction; one that no longer fits is skipped, the rest still apply).
  async apply(keys: readonly AccountMappingKey[], actor: SuggestionActor, correlationId: string): Promise<readonly ApplySuggestionResult[]> {
    const results: ApplySuggestionResult[] = [];
    for (const key of keys) {
      // Re-read each time: an earlier application may have created accounts whose codes the next one must not reuse.
      const current = (await this.suggestions(actor.companyId)).find((s) => s.key === key);
      if (!current) {
        results.push({ key, status: "SKIPPED", reason: "NO_LONGER_APPLICABLE" });
        continue;
      }
      try {
        let accountId: string;
        if (current.action === "CREATE_UNDER") {
          const folder = await this.prisma.account.findFirstOrThrow({ where: { companyId: actor.companyId, code: current.folderCode }, select: { id: true, type: true } });
          const created = await this.chart.create(
            { code: current.accountCode, name: current.accountName, ...(current.accountNameAr ? { nameAr: current.accountNameAr } : {}), type: folder.type as AccountType, isPostable: true, parentId: folder.id },
            actor,
            correlationId,
          );
          accountId = created.id;
        } else {
          accountId = (await this.prisma.account.findFirstOrThrow({ where: { companyId: actor.companyId, code: current.accountCode }, select: { id: true } })).id;
        }
        await this.mappings.set(key, accountId, actor, correlationId);
        results.push({ key, status: "APPLIED" });
      } catch (error) {
        results.push({ key, status: "SKIPPED", reason: error instanceof Error ? error.name : "UNEXPECTED" });
      }
    }
    return results;
  }
}
