import { Module } from "@nestjs/common";
import { loadEncryptionKey, OnboardingService, type ZatcaEnvironment } from "@erp/compliance-zatca-sa";
import type { IAuditLogger } from "@erp/core";
import { AUDIT_LOGGER } from "../identity/identity.tokens.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { ComplianceAdminService } from "./compliance-admin.service.js";
import { ComplianceController } from "./compliance.controller.js";

const VALID_ENVIRONMENTS: readonly ZatcaEnvironment[] = ["sandbox", "simulation", "production"];

function defaultEnvironment(): ZatcaEnvironment {
  const raw = process.env.ZATCA_ENVIRONMENT ?? "sandbox";
  if (!(VALID_ENVIRONMENTS as readonly string[]).includes(raw)) {
    throw new Error(`ZATCA_ENVIRONMENT must be one of ${VALID_ENVIRONMENTS.join(", ")} (got "${raw}")`);
  }
  return raw as ZatcaEnvironment;
}

@Module({
  controllers: [ComplianceController],
  providers: [
    {
      provide: ComplianceAdminService,
      // `onboarding` is a thunk, not an eagerly-constructed OnboardingService: ZATCA_KEY_ENCRYPTION_KEY is
      // only required once something actually tries to generate a key or decrypt one
      // (loadEncryptionKey throws KeyEncryptionError there, caught by ComplianceAdminService.service()
      // and turned into ComplianceError("ENCRYPTION_KEY_MISSING") -> 503). The API boots and every
      // read-only route works even before the key is configured.
      useFactory: (prisma: PrismaService, audit: IAuditLogger) =>
        new ComplianceAdminService(prisma, () => new OnboardingService(prisma, loadEncryptionKey()), audit, {
          defaultEnvironment: defaultEnvironment(),
          // No Resubmitter yet: nothing maps a SalesInvoice into a ZATCA submission (docs/01
          // section Z) and no BullMQ worker is registered for zatca-submission.job.ts. Wiring
          // one in is separate work, blocked on product decisions only Osama can make.
        }),
      inject: [PrismaService, AUDIT_LOGGER],
    },
  ],
})
export class ComplianceModule {}
