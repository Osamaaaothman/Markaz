import pino, { type DestinationStream } from "pino";

// docs/09-SECURITY-RULES.md §7: "Enforce with a central redaction utility in the
// logger, not developer discipline." The worker is a plain Node process, not a Nest
// app (docs/02-ARCHITECTURE-RULES.md §6), so it has no nestjs-pino HTTP middleware
// to configure this for it — this is that same central redaction, just for the
// worker's own structured logs. Exported as a factory (not only a singleton) so
// tests can inject a capturable stream instead of writing to real stdout
// (worker-logger.spec.ts) — production code uses the default export below.
export function createWorkerLogger(destination?: DestinationStream): pino.Logger {
  const options: pino.LoggerOptions = {
    redact: ["data.password", "data.token", "data.apiKey", "data.secret"],
  };
  return destination === undefined ? pino(options) : pino(options, destination);
}

export const workerLogger = createWorkerLogger();
