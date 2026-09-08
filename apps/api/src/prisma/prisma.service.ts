import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@erp/db";

// The API and worker connect as the restricted `erp_app` role (docker-compose.yml),
// never the migration-owner role — see the comment in that file and
// docs/04-DATA-MODEL-RULES.md §9.
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
