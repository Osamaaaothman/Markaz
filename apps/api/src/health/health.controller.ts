import { Controller, Get } from "@nestjs/common";

// docs/12-OPS-AND-DEPLOYMENT.md §7: liveness and readiness must be genuinely
// different. Readiness becomes a real DB/queue check once packages/db and the
// worker are wired in (M1+) — it must not fake success before then.
@Controller("health")
export class HealthController {
  @Get("live")
  live(): { status: "ok" } {
    return { status: "ok" };
  }

  @Get("ready")
  ready(): { status: "ok"; note: string } {
    return {
      status: "ok",
      note: "No dependencies wired yet (M0) — this will check DB/Redis from M1 onward.",
    };
  }
}
