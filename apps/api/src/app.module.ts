import { Module } from "@nestjs/common";
import { LoggerModule } from "nestjs-pino";
import { HealthController } from "./health/health.controller";

// M0: empty skeleton. Modules (inventory/purchasing/sales) and Core contracts
// are wired here starting M1/M2 — see docs/14-MILESTONES.md.
@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        // docs/09-SECURITY-RULES.md §7: never log request bodies of financial
        // endpoints, monetary amounts, or PII. Redaction rules land alongside the
        // first real endpoint that needs them (M1+).
        redact: ["req.headers.authorization"],
      },
    }),
  ],
  controllers: [HealthController],
})
export class AppModule {}
