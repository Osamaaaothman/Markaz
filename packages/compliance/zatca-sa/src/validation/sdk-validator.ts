// Runs the official ZATCA SDK's own `-validate` on a document, as the strongest local check there
// is: it applies ZATCA's real XSD and Schematron rules, which this repository does not contain.
//
// DEV / TEST ONLY. The SDK is a Java program Osama downloads from the ZATCA developer portal into
// `docs/vendor/zatca/sdk` (git-ignored: public, but not redistributed -- ADR 0004). It is never
// shipped to a customer deployment and nothing in the running product calls this file.
//
// CLI flags and verdict line verified with official SDK 3.4.8. Unknown output fails closed.
// PIH is caller-supplied chain context, not extracted from the XML being validated. A separate
// config per invocation prevents parallel suites from overwriting the SDK's shared pih.txt.
import { spawn } from "node:child_process";
import { existsSync, readdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

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

export function runSdkValidation(params: { readonly sdkDir: string; readonly xmlPath: string; readonly previousInvoiceHash?: string; readonly timeoutMs?: number }): Promise<SdkValidationResult> {
  const jar = findSdkJar(params.sdkDir);
  if (!jar) return Promise.reject(new Error(`No zatca-einvoicing-sdk*.jar under ${join(params.sdkDir, "Apps")}`));
  let config = join(params.sdkDir, "Configuration", "config.json");
  let workDir: string | undefined;
  if (params.previousInvoiceHash !== undefined) {
    const original = JSON.parse(readFileSync(config, "utf8")) as Record<string, unknown>;
    workDir = mkdtempSync(join(tmpdir(), "zatca-sdk-context-"));
    const pihPath = join(workDir, "pih.txt");
    writeFileSync(pihPath, params.previousInvoiceHash, "utf8");
    config = join(workDir, "config.json");
    writeFileSync(config, JSON.stringify({ ...original, pihPath }), "utf8");
  }
  const cleanup = (): void => { if (workDir) rmSync(workDir, { recursive: true, force: true }); };
  return new Promise((resolve, reject) => {
    // Array arguments, no shell: the path is ours, but there is no reason to ever give it one.
    // Java 11 on Windows otherwise reads Arabic XML using the system code page.
    const child = spawn("java", ["-Dfile.encoding=UTF-8", "-jar", jar, "-validate", "-invoice", params.xmlPath], {
      cwd: params.sdkDir,
      env: { ...process.env, SDK_CONFIG: config },
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
      cleanup();
      reject(e);
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      cleanup();
      resolve({ verdict: exitCode === 0 ? parseSdkVerdict(output) : "UNKNOWN", exitCode, output });
    });
  });
}
