import { Injectable, OnModuleDestroy } from "@nestjs/common";
import type IORedis from "ioredis";
import { createRedisConnection } from "./redis-connection.js";

// The API (HTTP) process's only use of Redis today is the readiness check
// (docs/12-OPS-AND-DEPLOYMENT.md §7) — it does not enqueue or process jobs itself;
// that is the worker process's job (docs/02-ARCHITECTURE-RULES.md §6). Business
// code writes to the outbox table instead of touching Redis directly
// (packages/core/src/outbox/outbox-writer.ts).
@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly connection: IORedis = createRedisConnection();

  async onModuleDestroy(): Promise<void> {
    await this.connection.quit();
  }
}
