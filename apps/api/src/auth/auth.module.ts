import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { AuthController } from "./auth.controller.js";
import { AuthService } from "./auth.service.js";
import { JwtAuthGuard } from "./jwt-auth.guard.js";

@Module({
  imports: [
    // registerAsync's factory runs during DI resolution inside NestFactory.create(),
    // which happens AFTER validateEnv() in main.ts — a plain register({ secret:
    // process.env.JWT_ACCESS_SECRET }) would read process.env at module-decoration
    // time instead, which happens at import time, BEFORE validateEnv ever runs.
    // That's not just a type-checking nuisance (the type error TS caught here) —
    // it was a real bug: env validation would not have actually protected this.
    JwtModule.registerAsync({
      global: true,
      // Non-null assertion is safe here specifically: validateEnv() in main.ts has
      // already exited the process if this were missing, and it runs strictly
      // before this factory does (see the comment above).
      useFactory: () => ({ secret: process.env.JWT_ACCESS_SECRET! }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard],
  exports: [JwtAuthGuard],
})
export class AuthModule {}
