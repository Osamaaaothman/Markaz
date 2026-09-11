import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { Public } from "../auth/public.decorator.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { RedisService } from "../jobs/redis.service.js";

// docs/12-OPS-AND-DEPLOYMENT.md §7: liveness and readiness must be genuinely
// different — readiness checks both the database (M0) and the queue (M3), since
// M3 is the first milestone where the API process depends on Redis being reachable.
@Controller("health")
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

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
    try {
      await this.redis.connection.ping();
    } catch {
      throw new ServiceUnavailableException("Queue (Redis) not reachable");
    }
    return { status: "ok" };
  }
}
