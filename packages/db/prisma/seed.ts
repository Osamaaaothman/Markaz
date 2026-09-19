// Install runbook step — docs/14-MILESTONES.md M1/M2: seed the initial admin user,
// default currency, chart of accounts template, and current fiscal year/periods.
// Run once per new deployment: npm run seed --workspace=@erp/db
//
// Never invents a credential (CLAUDE.md §4) — refuses to run without a real admin
// email/password supplied via environment, and refuses obvious placeholder values.
//
// The chart of accounts comes from coa-template.json (the accountant-supplied guide,
// levels 1-4) — docs/05-ACCOUNTING-INTEGRITY-RULES.md §4: "Each tenant starts from a
// seeded template and may customise it. The template is data, not code." A company
// customises it after install. Fiscal year defaults to the Gregorian calendar year
// with 12 monthly periods per docs/01-OPEN-DECISIONS.md assumption C4 — B7 (whether
// 13-period/adjustment periods are ever needed) is still open and does not block this
// default.
import { readFileSync } from "node:fs";
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
  { code: "role:read", description: "View roles in this company" },
  { code: "role:assign", description: "Assign a role to a user" },
  { code: "journal_entry:create", description: "Post a manual journal entry" },
  { code: "journal_entry:read", description: "View journal entries" },
  { code: "journal_entry:reverse", description: "Reverse a posted journal entry" },
  { code: "trial_balance:read", description: "View the trial balance" },
  { code: "balance_sheet:read", description: "View the balance sheet" },
  { code: "income_statement:read", description: "View the income statement" },
  { code: "account:read", description: "View the chart of accounts" },
  { code: "account:create", description: "Add an account to the chart of accounts" },
  { code: "account:update", description: "Edit an account's names, linked party and colour" },
  { code: "party:read", description: "View parties (people, companies, employees)" },
  { code: "party:create", description: "Add a party" },
  { code: "party:update", description: "Edit a party" },
  { code: "fiscal_period:read", description: "View fiscal periods" },
] as const;

const PLACEHOLDER_VALUES = new Set(["changeme", "password", "admin", "test", ""]);

interface AccountTemplateEntry {
  readonly code: string;
  readonly name: string;
  readonly nameAr: string;
  readonly type: "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";
  readonly normalBalance: "DEBIT" | "CREDIT";
  readonly isPostable: boolean;
  readonly parentCode?: string;
}

// The template is data, not code (docs/05-ACCOUNTING-INTEGRITY-RULES.md §4) — it lives
// in coa-template.json, generated from the accountant-supplied guide (levels 1-4 only;
// per-party level-5 accounts are per-company data). Entries are ordered parents-first.
const CHART_OF_ACCOUNTS_TEMPLATE = (
  JSON.parse(readFileSync(new URL("./coa-template.json", import.meta.url), "utf8")) as {
    accounts: readonly AccountTemplateEntry[];
  }
).accounts;

async function seedChartOfAccounts(companyId: string): Promise<void> {
  const codeToId = new Map<string, string>();
  // Parents first (the template is ordered that way), then children.
  for (const entry of CHART_OF_ACCOUNTS_TEMPLATE) {
    const parentId = entry.parentCode ? codeToId.get(entry.parentCode) : undefined;
    if (entry.parentCode && !parentId) {
      throw new Error(`Template account ${entry.code}: parent ${entry.parentCode} not seeded before it`);
    }
    const account = await prisma.account.upsert({
      where: { companyId_code: { companyId, code: entry.code } },
      create: {
        id: uuidv7(),
        companyId,
        code: entry.code,
        name: entry.name,
        nameAr: entry.nameAr,
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
