import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { Public } from "../auth/public.decorator.js";
import { PrismaService } from "../prisma/prisma.service.js";

// docs/12-OPS-AND-DEPLOYMENT.md §7: liveness and readiness must be genuinely
// different — readiness now genuinely checks the database, as promised in M0.
@Controller("health")
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get("live")
  live(): { status: "ok" } {
    return { status: "ok" };
  }

  @Public()
  @Get("ready")
  async ready(): Promise<{ status: "ok" }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException("Database not reachable");
    }
    return { status: "ok" };
  }
}
