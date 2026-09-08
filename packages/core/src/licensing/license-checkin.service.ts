import type { PrismaClient } from "@erp/db";
import type { Clock } from "@erp/shared";
import { ActivationServiceClient } from "./activation-client.js";
import { computeLicenseStatus, DEFAULT_GRACE_PERIOD_MS } from "./grace-period.js";

// Orchestrates one check-in attempt: call the Activation Service, then persist the
// outcome to the local license_state singleton row. Intended to run periodically
// from the worker process (docs/02-ARCHITECTURE-RULES.md §6), never from an HTTP
// request path.
export class LicenseCheckinService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly client: ActivationServiceClient,
    private readonly clock: Clock,
    private readonly graceMs: number = DEFAULT_GRACE_PERIOD_MS,
  ) {}

  async runCheckin(): Promise<void> {
    const now = this.clock.now();
    const seatsUsed = await this.prisma.user.count({ where: { isActive: true } });
    const result = await this.client.checkin(seatsUsed);

    const current = await this.prisma.licenseState.findUnique({ where: { id: "singleton" } });

    if (result.outcome === "SUCCESS") {
      // See the note in audit-logger.ts — `exactOptionalPropertyTypes` needs the
      // key omitted, not present-and-undefined, when result.seatsAllowed is absent.
      const seatsAllowedField =
        result.seatsAllowed !== undefined ? { seatsAllowed: result.seatsAllowed } : {};
      await this.prisma.licenseState.upsert({
        where: { id: "singleton" },
        create: {
          id: "singleton",
          status: "OK",
          lastSuccessfulCheckinAt: now,
          lastAttemptAt: now,
          seatsUsed: result.seatsUsed ?? seatsUsed,
          ...seatsAllowedField,
        },
        update: {
          status: "OK",
          lastSuccessfulCheckinAt: now,
          lastAttemptAt: now,
          seatsUsed: result.seatsUsed ?? seatsUsed,
          ...seatsAllowedField,
        },
      });
      return;
    }

    if (result.outcome === "REJECTED") {
      // Explicit rejection/revocation from the Activation Service — the one path
      // that CAN set LOCKED. Never inferred from silence (see grace-period.ts).
      await this.prisma.licenseState.upsert({
        where: { id: "singleton" },
        create: { id: "singleton", status: "LOCKED", lastAttemptAt: now },
        update: { status: "LOCKED", lastAttemptAt: now },
      });
      return;
    }

    // UNREACHABLE: recompute status from the grace-period rule against whatever the
    // last successful check-in was, or UNCONFIGURED if the client has no URL/key set.
    const status = computeLicenseStatus({
      now,
      configured: this.client.isConfigured(),
      lastSuccessfulCheckinAt: current?.lastSuccessfulCheckinAt ?? null,
      graceMs: this.graceMs,
    });

    await this.prisma.licenseState.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", status, lastAttemptAt: now },
      update: { status, lastAttemptAt: now },
    });
  }
}
