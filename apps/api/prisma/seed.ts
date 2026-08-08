import { PrismaPg } from "@prisma/adapter-pg";
import * as argon2 from "argon2";
import { PrismaClient } from "../generated/prisma/client";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const ROLES = ["Admin", "Accountant", "Warehouse Staff", "Purchasing Officer", "HR"] as const;

async function main() {
  for (const name of ROLES) {
    await prisma.role.upsert({ where: { name }, update: {}, create: { name } });
  }

  const adminRole = await prisma.role.findUniqueOrThrow({ where: { name: "Admin" } });

  // A couple of example permissions wired to Admin, to prove the
  // Role/Permission/RolePermission model works end to end. Real per-module
  // permissions get added alongside the endpoints that need them.
  for (const action of ["settings:manage", "users:manage"]) {
    const permission = await prisma.permission.upsert({
      where: { action },
      update: {},
      create: { action },
    });
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: adminRole.id, permissionId: permission.id } },
      update: {},
      create: { roleId: adminRole.id, permissionId: permission.id },
    });
  }

  const email = process.env.ADMIN_SEED_EMAIL ?? "admin@markaz.local";
  const password = process.env.ADMIN_SEED_PASSWORD ?? "changeme123";
  const passwordHash = await argon2.hash(password);

  await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, name: "Admin", passwordHash, roleId: adminRole.id },
  });

  console.log(`Seeded ${ROLES.length} roles and admin user "${email}".`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
