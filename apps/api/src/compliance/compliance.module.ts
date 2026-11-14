import { Module } from "@nestjs/common";
import type IORedis from "ioredis";
import { loadEncryptionKey, OnboardingService, type ZatcaEnvironment } from "@erp/compliance-zatca-sa";
import type { IAuditLogger } from "@erp/core";
import { AUDIT_LOGGER } from "../identity/identity.tokens.js";
import { createQueue } from "../jobs/create-monitored-worker.js";
import { RedisService } from "../jobs/redis.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { ComplianceAdminService, type Resubmitter } from "./compliance-admin.service.js";
import { ComplianceController } from "./compliance.controller.js";
import { zatcaSubmissionQueueName, type ZatcaSubmissionJobData } from "./zatca-submission.job.js";

const VALID_ENVIRONMENTS: readonly ZatcaEnvironment[] = ["sandbox", "simulation", "production"];

function defaultEnvironment(): ZatcaEnvironment {
  const raw = process.env.ZATCA_ENVIRONMENT ?? "sandbox";
  if (!(VALID_ENVIRONMENTS as readonly string[]).includes(raw)) {
    throw new Error(`ZATCA_ENVIRONMENT must be one of ${VALID_ENVIRONMENTS.join(", ")} (got "${raw}")`);
  }
  return raw as ZatcaEnvironment;
}

// "Try this invoice again" from the compliance screen: put one job on that EGS unit's own queue.
// The API process never processes jobs (docs/02-ARCHITECTURE-RULES.md §6) — apps/api/src/worker.ts
// owns the per-EGS worker with concurrency 1 — so all this does is enqueue.
//
// A resubmit is safe precisely because InvoiceSubmissionService resumes the SAME ICV/previous hash
// recorded for the invoice rather than reserving a new chain position
// (packages/compliance/zatca-sa/src/submission/invoice-submission.service.ts).
//
// NOTE: the mapper those workers need (ZatcaInvoiceMapper) is NOT provided here. It takes a
// decrypted encryption key in its constructor, and building it eagerly would make the API refuse
// to boot without ZATCA_KEY_ENCRYPTION_KEY — exactly what the `onboarding` thunk below avoids.
// worker.ts builds it instead, inside a try/catch that skips ZATCA workers when the key is absent
// (it is not a Nest context and does not resolve providers).
class ZatcaQueueResubmitter implements Resubmitter {
  constructor(private readonly connection: IORedis) {}

  async enqueue(salesInvoiceId: string, egsUnitId: string): Promise<void> {
    const queue = createQueue<ZatcaSubmissionJobData>(zatcaSubmissionQueueName(egsUnitId), this.connection);
    try {
      // The invoice id doubles as the correlation id: one resubmit request, one traceable job.
      await queue.add("zatca-submission", { salesInvoiceId, egsUnitId, correlationId: salesInvoiceId });
    } finally {
      await queue.close();
    }
  }
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
      useFactory: (prisma: PrismaService, audit: IAuditLogger, redis: RedisService) =>
        new ComplianceAdminService(prisma, () => new OnboardingService(prisma, loadEncryptionKey()), audit, {
          defaultEnvironment: defaultEnvironment(),
          // Invoices now carry an issuing EGS unit and write their submission intent to the outbox
          // in the same transaction that posts them (packages/core/src/sales/sales-invoice.service.ts),
          // so a retry from this screen has a real queue and a real worker behind it.
          resubmitter: new ZatcaQueueResubmitter(redis.connection),
        }),
      inject: [PrismaService, AUDIT_LOGGER, RedisService],
    },
  ],
})
export class ComplianceModule {}
