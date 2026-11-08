// Runs the official ZATCA SDK's own `-validate` on a document, as the strongest local check there
// is: it applies ZATCA's real XSD and Schematron rules, which this repository does not contain.
//
// DEV / TEST ONLY. The SDK is a Java program Osama downloads from the ZATCA developer portal into
// `docs/vendor/zatca/sdk` (git-ignored: public, but not redistributed -- ADR 0004). It is never
// shipped to a customer deployment and nothing in the running product calls this file.
//
// REVIEW: written WITHOUT the SDK on hand (the session that wrote it had no network access to
// ZATCA and no SDK copy), from the SDK's documented command line and from how the sibling session
// ran the same jar for CSR generation (`java -jar <jar> ... ` with SDK_CONFIG pointing at
// Configuration/config.json). Two details are therefore unconfirmed and are handled so that a
// wrong guess can only ever produce "UNKNOWN", never a false "PASSED":
//   - the exact flags (`-validate -invoice <file>`), and
//   - the verdict line the jar prints (`GLOBAL VALIDATION RESULT = PASSED|FAILED`).
// If the first run on a machine with the SDK prints UNKNOWN, read `output` and adjust
// VERDICT_PATTERN / the arguments here -- do not change a test to accept UNKNOWN.
import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

export type SdkVerdict = "PASSED" | "FAILED" | "UNKNOWN";

export interface SdkValidationResult {
  readonly verdict: SdkVerdict;
  readonly exitCode: number | null;
  // The jar's complete stdout + stderr, kept so a failure (or an UNKNOWN) can be read, never summarised away.
  readonly output: string;
}

const VERDICT_PATTERN = /GLOBAL VALIDATION RESULT\s*=\s*(PASSED|FAILED)/i;

export function parseSdkVerdict(output: string): SdkVerdict {
  const match = VERDICT_PATTERN.exec(output);
  if (!match) return "UNKNOWN";
  return match[1]!.toUpperCase() === "PASSED" ? "PASSED" : "FAILED";
}

export function findSdkJar(sdkDir: string): string | undefined {
  const apps = join(sdkDir, "Apps");
  if (!existsSync(apps)) return undefined;
  return readdirSync(apps)
    .filter((f) => /^zatca-einvoicing-sdk.*\.jar$/.test(f))
    .map((f) => join(apps, f))[0];
}

export function runSdkValidation(params: { readonly sdkDir: string; readonly xmlPath: string; readonly timeoutMs?: number }): Promise<SdkValidationResult> {
  const jar = findSdkJar(params.sdkDir);
  if (!jar) return Promise.reject(new Error(`No zatca-einvoicing-sdk*.jar under ${join(params.sdkDir, "Apps")}`));
  return new Promise((resolve, reject) => {
    // Array arguments, no shell: the path is ours, but there is no reason to ever give it one.
    const child = spawn("java", ["-jar", jar, "-validate", "-invoice", params.xmlPath], {
      cwd: params.sdkDir,
      env: { ...process.env, SDK_CONFIG: join(params.sdkDir, "Configuration", "config.json") },
    });
    let output = "";
    child.stdout.on("data", (d: Buffer) => (output += d.toString("utf8")));
    child.stderr.on("data", (d: Buffer) => (output += d.toString("utf8")));
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`The SDK validator did not finish within ${params.timeoutMs ?? 120_000} ms`));
    }, params.timeoutMs ?? 120_000);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolve({ verdict: parseSdkVerdict(output), exitCode, output });
    });
  });
}
