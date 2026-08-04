import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { cleanupOpenApiDoc } from "nestjs-zod";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors();

  // Swagger docs are generated from the same Zod DTOs used for request
  // validation, so they can't silently drift out of sync with the code.
  const config = new DocumentBuilder()
    .setTitle("ERP API")
    .setDescription("Internal REST API for the ERP desktop client")
    .setVersion("0.0.0")
    .build();
  const document = cleanupOpenApiDoc(SwaggerModule.createDocument(app, config));
  SwaggerModule.setup("docs", app, document);

  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  await app.listen(port);
  console.log(`API listening on http://localhost:${port}`);
  console.log(`Swagger docs on http://localhost:${port}/docs`);
}

bootstrap();
