import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { IsIn, IsOptional, IsString, MinLength, validateSync } from "class-validator";

// docs/12-OPS-AND-DEPLOYMENT.md §9: "the process fails fast with a clear message if
// a required variable is missing — never on the first request that needs it."
class EnvSchema {
  @IsIn(["development", "test", "production"])
  NODE_ENV!: string;

  @IsString()
  @MinLength(1)
  DATABASE_URL!: string;

  @IsString()
  @MinLength(1)
  REDIS_URL!: string;

  @IsString()
  @MinLength(32, { message: "JWT_ACCESS_SECRET must be at least 32 characters" })
  JWT_ACCESS_SECRET!: string;

  @IsOptional()
  @IsString()
  ACTIVATION_SERVICE_URL?: string;

  @IsOptional()
  @IsString()
  LICENSE_MASTER_KEY?: string;
}

export function validateEnv(env: Record<string, unknown>): void {
  const instance = plainToInstance(EnvSchema, env, { excludeExtraneousValues: false });
  const errors = validateSync(instance, { skipMissingProperties: false });

  if (errors.length > 0) {
    const messages = errors
      .map((e) => Object.values(e.constraints ?? {}).join(", "))
      .join("; ");
    // No logger exists yet at this point in bootstrap — console is the right tool.
    console.error(`Invalid environment configuration: ${messages}`);
    process.exit(1);
  }
}
