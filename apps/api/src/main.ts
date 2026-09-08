import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { Logger } from "nestjs-pino";
import { AppModule } from "./app.module.js";
import { validateEnv } from "./config/env.validation.js";

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
