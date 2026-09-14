import { PassThrough } from "node:stream";
import { createWorkerLogger } from "./worker-logger.js";

// docs/09-SECURITY-RULES.md §7: "write a test that asserts a fully populated
// [record] produces logs containing none of its sensitive values." This is that
// test for the worker's logger — proves the redaction actually strips the secret
// from the emitted JSON line, not just that the option is present in the config.
function captureOneLogLine(log: (logger: ReturnType<typeof createWorkerLogger>) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const stream = new PassThrough();
    let raw = "";
    stream.on("data", (chunk: Buffer) => {
      raw += chunk.toString();
    });
    stream.on("error", reject);
    const logger = createWorkerLogger(stream);
    log(logger);
    // pino writes synchronously to a stream destination, but give the event loop
    // one tick so the 'data' handler above has definitely run before we read it.
    setImmediate(() => resolve(raw));
  });
}

describe("createWorkerLogger redaction", () => {
  it("strips a secret value from the emitted log line, not just the key", async () => {
    const secret = "correct horse battery staple";
    const raw = await captureOneLogLine((logger) => {
      logger.info({ data: { password: secret, correlationId: "abc-123" } }, "job.started");
    });

    expect(raw).not.toContain(secret);
    const parsed = JSON.parse(raw) as { data: { password: string; correlationId: string } };
    expect(parsed.data.password).toBe("[Redacted]");
    // Redaction must be scoped — it should not swallow adjacent, non-sensitive
    // fields on the same object.
    expect(parsed.data.correlationId).toBe("abc-123");
  });

  it("redacts token/apiKey/secret alongside password", async () => {
    const raw = await captureOneLogLine((logger) => {
      logger.error(
        { data: { token: "tok_live_xyz", apiKey: "ak_live_xyz", secret: "sh_live_xyz" } },
        "job.dead_lettered",
      );
    });

    expect(raw).not.toContain("tok_live_xyz");
    expect(raw).not.toContain("ak_live_xyz");
    expect(raw).not.toContain("sh_live_xyz");
  });
});
