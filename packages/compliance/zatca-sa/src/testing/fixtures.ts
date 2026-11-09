// Shared test fixtures for the compliance pack. Test-only: nothing under src/ outside *.spec.ts
// and this folder may import it.
//
// Two kinds of fixture, kept apart on purpose:
//
//  1. The official ZATCA SDK's own files (sample XML, certificate and key). They are public but we
//     do not redistribute them (docs/adr/0004-zatca-direct-integration.md), so `docs/vendor/` is
//     git-ignored and a cloud checkout or CI runner does not have them. Tests that compare our
//     output against them are the strongest proof we have, so they run whenever the SDK is
//     present (`ZATCA_SDK_DIR` overrides the default location) and are reported as SKIPPED -- by
//     name, with the missing path -- when it is not. They are never silently dropped.
//
//  2. A throw-away secp256k1 key and self-signed certificate made with the `openssl` CLI at test
//     time. These let every pipeline test (signing, submission, onboarding) run anywhere, so the
//     orchestration is covered by CI even though the byte-for-byte SDK comparisons are not.
//     A generated certificate is NOT issued by ZATCA and proves nothing about ZATCA acceptance.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const SDK_ROOT: string = process.env.ZATCA_SDK_DIR ?? join(__dirname, "..", "..", "..", "..", "..", "docs", "vendor", "zatca", "sdk");
export const SDK_CERTS: string = join(SDK_ROOT, "Data", "Certificates");
export const SDK_SAMPLES: string = join(SDK_ROOT, "Data", "Samples");
export const SDK_AVAILABLE: boolean = existsSync(SDK_CERTS) && existsSync(SDK_SAMPLES);

// Like `describe`, but when the official SDK is not on this machine the body is NOT executed (a
// plain `describe.skip` still runs the callback to collect tests, which is what made suites that
// read SDK files while registering crash instead of skip) and a single named, skipped test
// records why.
export function describeIfSdk(name: string, body: () => void): void {
  if (SDK_AVAILABLE) {
    describe(name, body);
    return;
  }
  describe.skip(`${name} [skipped: official ZATCA SDK not found at ${SDK_ROOT}]`, () => {
    it("needs the SDK's sample files", () => undefined);
  });
}

export interface TestCertificate {
  // Raw base64 of the DER certificate, no armor -- the same shape ZATCA's `binarySecurityToken` and
  // the SDK's own `cert.pem` use.
  readonly certificateBase64: string;
  readonly certificatePem: string;
  // Armored SEC1 "EC PRIVATE KEY".
  readonly privateKeyPem: string;
}

let cached: TestCertificate | undefined;

// One key/certificate pair per jest worker; generating is cheap but not free.
export function generateTestCertificate(): TestCertificate {
  if (cached) return cached;
  const dir = mkdtempSync(join(tmpdir(), "zatca-test-cert-"));
  try {
    const keyPath = join(dir, "key.pem");
    const certPath = join(dir, "cert.pem");
    // Some machines have a system-wide OPENSSL_CONF pointing at a path that doesn't exist for
    // THIS openssl build (observed here: a PostgreSQL/psqlODBC install sets one globally, which
    // the Git-for-Windows openssl on PATH can't read) -- clearing it for this subprocess only
    // lets openssl fall back to its own compiled-in default config, not a system setting.
    const env = { ...process.env, OPENSSL_CONF: "" };
    execFileSync("openssl", ["ecparam", "-name", "secp256k1", "-genkey", "-noout", "-out", keyPath], { stdio: "pipe", env });
    execFileSync("openssl", ["req", "-new", "-x509", "-key", keyPath, "-subj", "/C=SA/O=Markaz Test/CN=markaz-test-egs", "-days", "1825", "-sha256", "-out", certPath], { stdio: "pipe", env });
    const certificatePem = readFileSync(certPath, "utf8");
    const certificateBase64 = certificatePem
      .split("\n")
      .filter((line) => line.length > 0 && !line.startsWith("-----"))
      .join("");
    cached = { certificateBase64, certificatePem, privateKeyPem: readFileSync(keyPath, "utf8") };
    return cached;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
