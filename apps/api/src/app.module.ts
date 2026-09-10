import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { LoggerModule } from "nestjs-pino";
import { HealthController } from "./health/health.controller.js";
import { PrismaModule } from "./prisma/prisma.module.js";
import { CommonModule } from "./common/common.module.js";
import { IdentityModule } from "./identity/identity.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { AccountingModule } from "./accounting/accounting.module.js";
import { JwtAuthGuard } from "./auth/jwt-auth.guard.js";
import { PermissionGuard } from "./identity/permission.guard.js";
import { HttpExceptionFilter } from "./common/http-exception.filter.js";

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        // pino-http auto-generates a request id by default — no genReqId override
        // needed; docs/03-MULTI-TENANCY-RULES.md §9 / docs/09 §7 just needs
        // something on every log line, which the default already provides.
        //
        // docs/09-SECURITY-RULES.md §7: never log request bodies of financial
        // endpoints, monetary amounts, or PII. Redaction rules grow alongside the
        // first real financial endpoint that needs them (M2+).
        redact: ["req.headers.authorization", "req.body.password"],
      },
    }),
    PrismaModule,
    CommonModule,
    IdentityModule,
    AuthModule,
    AccountingModule,
  ],
  controllers: [HealthController],
  providers: [
    // Order matters: JwtAuthGuard runs first and populates req.user; PermissionGuard
    // depends on it being set.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule {}
