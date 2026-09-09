// Install runbook step — docs/14-MILESTONES.md M1: "seed... initial admin user."
// Run once per new deployment: npm run seed --workspace=@erp/db
//
// Never invents a credential (CLAUDE.md §4) — refuses to run without a real admin
// email/password supplied via environment, and refuses obvious placeholder values.
import { PrismaClient } from "@prisma/client";
import { hash } from "@node-rs/argon2";
import { uuidv7 } from "uuidv7";

const prisma = new PrismaClient();

const PERMISSION_CATALOG = [
  { code: "user:create", description: "Create a new user in this company" },
  { code: "user:read", description: "View users in this company" },
  { code: "role:create", description: "Create a new role" },
  { code: "role:assign", description: "Assign a role to a user" },
] as const;

const PLACEHOLDER_VALUES = new Set(["changeme", "password", "admin", "test", ""]);

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

  const existingAdmin = await prisma.user.findUnique({ where: { email: adminEmail } });
  if (existingAdmin) {
    console.log(`Admin user ${adminEmail} already exists — skipping user creation.`);
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

  console.log(`Seeded company "${company.name}" and admin user ${admin.email}.`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
