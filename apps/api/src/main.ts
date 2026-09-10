import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { Logger } from "nestjs-pino";
import { AppModule } from "./app.module.js";
import { validateEnv } from "./config/env.validation.js";

// docs/04-DATA-MODEL-RULES.md §3: calendar dates must be UTC-explicit. A local-
// timezone `new Date(y, m, d)` shifts to the wrong calendar day when serialized to
// a `@db.Date` column on any machine whose local timezone isn't UTC (bit an early
// draft of the M2 integration test on a UTC+3 machine). Forcing the whole process
// to run in UTC removes this entire bug class rather than relying on every call
// site remembering `Date.UTC(...)`. Docker also sets this via ENV — this is a
// fallback for `node dist/main.js` run outside a container.
process.env.TZ = process.env.TZ ?? "UTC";

async function bootstrap(): Promise<void> {
  // docs/12-OPS-AND-DEPLOYMENT.md §9: fail fast on bad config, before anything else
  // starts — never on the first request that needs the missing variable.
  validateEnv(process.env);

  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();

  // docs/07-API-RULES.md §3: reject unknown fields, validate at the boundary.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const port = process.env.API_PORT ?? 3000;
  await app.listen(port);
}

void bootstrap();
