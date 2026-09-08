import { Global, Module } from "@nestjs/common";
import { SystemClock } from "@erp/shared";
import { CLOCK } from "./tokens.js";

// docs/10-TESTING-RULES.md §3: inject the clock, don't call `new Date()` inline in
// business logic — this is the one place SystemClock is actually constructed.
@Global()
@Module({
  providers: [{ provide: CLOCK, useValue: new SystemClock() }],
  exports: [CLOCK],
})
export class CommonModule {}
