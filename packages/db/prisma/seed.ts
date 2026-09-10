// Install runbook step — docs/14-MILESTONES.md M1/M2: seed the initial admin user,
// default currency, chart of accounts template, and current fiscal year/periods.
// Run once per new deployment: npm run seed --workspace=@erp/db
//
// Never invents a credential (CLAUDE.md §4) — refuses to run without a real admin
// email/password supplied via environment, and refuses obvious placeholder values.
//
// The chart of accounts below is a generic, uncontroversial starting template
// (standard 1000s/2000s/3000s/4000s/5000s numbering) — docs/05-ACCOUNTING-INTEGRITY-RULES.md
// §4: "Each tenant starts from a seeded template and may customise it. The template
// is data, not code." It is NOT a specific accounting treatment decision; a company
// customises it after install. Fiscal year defaults to the Gregorian calendar year
// with 12 monthly periods per docs/01-OPEN-DECISIONS.md assumption C4 — B7 (whether
// 13-period/adjustment periods are ever needed) is still open and does not block this
// default.
import { PrismaClient } from "@prisma/client";
import { hash } from "@node-rs/argon2";
import { uuidv7 } from "uuidv7";

// docs/04-DATA-MODEL-RULES.md §3 — see the matching comment in apps/api/src/main.ts.
process.env.TZ = process.env.TZ ?? "UTC";

const prisma = new PrismaClient();

const PERMISSION_CATALOG = [
  { code: "user:create", description: "Create a new user in this company" },
  { code: "user:read", description: "View users in this company" },
  { code: "role:create", description: "Create a new role" },
  { code: "role:assign", description: "Assign a role to a user" },
  { code: "journal_entry:create", description: "Post a manual journal entry" },
  { code: "journal_entry:reverse", description: "Reverse a posted journal entry" },
  { code: "trial_balance:read", description: "View the trial balance" },
] as const;

const PLACEHOLDER_VALUES = new Set(["changeme", "password", "admin", "test", ""]);

interface AccountTemplateEntry {
  readonly code: string;
  readonly name: string;
  readonly type: "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";
  readonly normalBalance: "DEBIT" | "CREDIT";
  readonly isPostable: boolean;
  readonly parentCode?: string;
}

const CHART_OF_ACCOUNTS_TEMPLATE: readonly AccountTemplateEntry[] = [
  { code: "1000", name: "Assets", type: "ASSET", normalBalance: "DEBIT", isPostable: false },
  { code: "1100", name: "Cash", type: "ASSET", normalBalance: "DEBIT", isPostable: true, parentCode: "1000" },
  { code: "1200", name: "Bank", type: "ASSET", normalBalance: "DEBIT", isPostable: true, parentCode: "1000" },
  { code: "1300", name: "Accounts Receivable", type: "ASSET", normalBalance: "DEBIT", isPostable: true, parentCode: "1000" },
  { code: "1400", name: "Inventory", type: "ASSET", normalBalance: "DEBIT", isPostable: true, parentCode: "1000" },

  { code: "2000", name: "Liabilities", type: "LIABILITY", normalBalance: "CREDIT", isPostable: false },
  { code: "2100", name: "Accounts Payable", type: "LIABILITY", normalBalance: "CREDIT", isPostable: true, parentCode: "2000" },
  { code: "2200", name: "VAT Payable", type: "LIABILITY", normalBalance: "CREDIT", isPostable: true, parentCode: "2000" },

  { code: "3000", name: "Equity", type: "EQUITY", normalBalance: "CREDIT", isPostable: false },
  { code: "3100", name: "Owner's Equity", type: "EQUITY", normalBalance: "CREDIT", isPostable: true, parentCode: "3000" },
  { code: "3200", name: "Retained Earnings", type: "EQUITY", normalBalance: "CREDIT", isPostable: true, parentCode: "3000" },

  { code: "4000", name: "Revenue", type: "REVENUE", normalBalance: "CREDIT", isPostable: false },
  { code: "4100", name: "Sales Revenue", type: "REVENUE", normalBalance: "CREDIT", isPostable: true, parentCode: "4000" },

  { code: "5000", name: "Expenses", type: "EXPENSE", normalBalance: "DEBIT", isPostable: false },
  { code: "5100", name: "Cost of Goods Sold", type: "EXPENSE", normalBalance: "DEBIT", isPostable: true, parentCode: "5000" },
  { code: "5200", name: "Operating Expenses", type: "EXPENSE", normalBalance: "DEBIT", isPostable: true, parentCode: "5000" },
];

async function seedChartOfAccounts(companyId: string): Promise<void> {
  const codeToId = new Map<string, string>();
  // Parents first (isPostable: false rows have no parentCode), then children —
  // the template array is already ordered that way.
  for (const entry of CHART_OF_ACCOUNTS_TEMPLATE) {
    const parentId = entry.parentCode ? codeToId.get(entry.parentCode) : undefined;
    const account = await prisma.account.upsert({
      where: { companyId_code: { companyId, code: entry.code } },
      create: {
        id: uuidv7(),
        companyId,
        code: entry.code,
        name: entry.name,
        type: entry.type,
        normalBalance: entry.normalBalance,
        isPostable: entry.isPostable,
        ...(parentId ? { parentId } : {}),
      },
      update: {},
    });
    codeToId.set(entry.code, account.id);
  }
}

async function seedCurrentFiscalYear(companyId: string): Promise<void> {
  const year = new Date().getFullYear();
  const fiscalYear = await prisma.fiscalYear.upsert({
    where: { companyId_name: { companyId, name: `FY${year}` } },
    create: {
      id: uuidv7(),
      companyId,
      name: `FY${year}`,
      startDate: new Date(Date.UTC(year, 0, 1)),
      endDate: new Date(Date.UTC(year, 11, 31)),
    },
    update: {},
  });

  for (let month = 0; month < 12; month++) {
    await prisma.fiscalPeriod.upsert({
      where: { companyId_fiscalYearId_periodNumber: { companyId, fiscalYearId: fiscalYear.id, periodNumber: month + 1 } },
      create: {
        id: uuidv7(),
        companyId,
        fiscalYearId: fiscalYear.id,
        periodNumber: month + 1,
        startDate: new Date(Date.UTC(year, month, 1)),
        endDate: new Date(Date.UTC(year, month + 1, 0)),
      },
      update: {},
    });
  }
}

async function main(): Promise<void> {
  const adminEmail = process.env.SEED_ADMIN_EMAIL;
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;

  if (!adminEmail || !adminPassword) {
    throw new Error(
      "SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD must be set — see .env.example. Refusing to invent one.",
    );
  }
  if (PLACEHOLDER_VALUES.has(adminPassword.toLowerCase()) || adminPassword.length < 12) {
    throw new Error("SEED_ADMIN_PASSWORD looks like a placeholder or is too short (min 12 chars).");
  }

  const company = await prisma.company.upsert({
    where: { id: "default-company" },
    create: { id: "default-company", name: "Default Company" },
    update: {},
  });

  await prisma.currency.upsert({
    where: { code: "SAR" },
    create: { code: "SAR", name: "Saudi Riyal", minorUnitDigits: 2 },
    update: {},
  });

  for (const permission of PERMISSION_CATALOG) {
    await prisma.permission.upsert({
      where: { code: permission.code },
      create: { id: uuidv7(), code: permission.code, description: permission.description },
      update: { description: permission.description },
    });
  }

  const adminRole = await prisma.role.upsert({
    where: { companyId_name: { companyId: company.id, name: "Admin" } },
    create: { id: uuidv7(), companyId: company.id, name: "Admin" },
    update: {},
  });

  const allPermissions = await prisma.permission.findMany();
  for (const permission of allPermissions) {
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: adminRole.id, permissionId: permission.id } },
      create: { roleId: adminRole.id, permissionId: permission.id },
      update: {},
    });
  }

  await seedChartOfAccounts(company.id);
  await seedCurrentFiscalYear(company.id);

  const existingAdmin = await prisma.user.findUnique({ where: { email: adminEmail } });
  if (existingAdmin) {
    console.log(`Admin user ${adminEmail} already exists — skipping user creation.`);
    console.log(`Seeded company "${company.name}", chart of accounts, and current fiscal year.`);
    return;
  }

  const passwordHash = await hash(adminPassword);
  const admin = await prisma.user.create({
    data: {
      id: uuidv7(),
      companyId: company.id,
      email: adminEmail,
      passwordHash,
      roles: { create: [{ roleId: adminRole.id }] },
    },
  });

  console.log(
    `Seeded company "${company.name}", chart of accounts, current fiscal year, and admin user ${admin.email}.`,
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
