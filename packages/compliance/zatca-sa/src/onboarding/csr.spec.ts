import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateCsr, generateEcPrivateKeyPem, generateKeyAndCsr, type CsrInput } from "./csr.js";

// Some machines set a system-wide OPENSSL_CONF pointing at a config file that no longer exists
// (observed on this dev machine: a stale path from an unrelated PostgreSQL ODBC driver install).
// openssl.ts's own calls always pass `-config` explicitly and are unaffected, but this test's
// own ad-hoc verification commands below (req -verify/-text/-pubkey) don't need any config
// *content*, just a config file that exists — so point OPENSSL_CONF at an empty one for them.
const emptyOpensslConfDir = mkdtempSync(join(tmpdir(), "openssl-empty-conf-"));
const emptyOpensslConfPath = join(emptyOpensslConfDir, "empty.cnf");
writeFileSync(emptyOpensslConfPath, "");
const OPENSSL_ENV = { ...process.env, OPENSSL_CONF: emptyOpensslConfPath };

const baseInput: CsrInput = {
  commonName: "Till-1",
  organizationUnit: "Riyadh Branch",
  organizationName: "Maximum Speed Tech Supply LTD",
  countryCode: "SA",
  egsSerial: "1-MarkazPOS|2-M1|3-ed22f1d8-e6a2-1118-9b58-d9a8f11e445f",
  vatNumber: "399999999900003",
  invoiceTypeDigits: "1100",
  location: "RRRD2929",
  businessCategory: "Retail",
  certificateTemplateName: "TSTZATCA-Code-Signing",
};

describe("generateEcPrivateKeyPem", () => {
  it("generates a PEM-armored secp256k1 EC private key", () => {
    const pem = generateEcPrivateKeyPem();
    expect(pem).toContain("-----BEGIN EC PRIVATE KEY-----");
    const text = execFileSync("openssl", ["ec", "-noout", "-text"], { input: pem, encoding: "utf8", env: OPENSSL_ENV });
    expect(text).toMatch(/secp256k1/i);
  });

  it("generates a different key each time", () => {
    expect(generateEcPrivateKeyPem()).not.toBe(generateEcPrivateKeyPem());
  });
});

describe("generateCsr", () => {
  const { privateKeyPem, csrPem } = generateKeyAndCsr(baseInput);

  it("produces a PEM CSR whose signature verifies (proof of possession of the private key)", () => {
    expect(csrPem).toContain("-----BEGIN CERTIFICATE REQUEST-----");
    // `openssl req -verify` fails loudly (non-zero exit, caught by jest as a thrown error) if the
    // CSR's self-signature does not verify against its own embedded public key.
    expect(() => execFileSync("openssl", ["req", "-verify", "-noout"], { input: csrPem, encoding: "utf8", env: OPENSSL_ENV })).not.toThrow();
  });

  it("embeds the public key matching the private key it was signed with", () => {
    const dir = mkdtempSync(join(tmpdir(), "zatca-csr-test-"));
    try {
      const keyPath = join(dir, "key.pem");
      writeFileSync(keyPath, privateKeyPem);
      const expectedPub = execFileSync("openssl", ["ec", "-in", keyPath, "-pubout"], { encoding: "utf8", env: OPENSSL_ENV });
      const actualPub = execFileSync("openssl", ["req", "-pubkey", "-noout"], { input: csrPem, encoding: "utf8", env: OPENSSL_ENV });
      expect(actualPub).toBe(expectedPub);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function csrText(csr: string): string {
    return execFileSync("openssl", ["req", "-noout", "-text"], { input: csr, encoding: "utf8", env: OPENSSL_ENV });
  }

  it("carries the distinguished name fields (C, OU, O, CN)", () => {
    // openssl 3.2.3's one-line "Subject:" summary has no spaces around "="; other versions may
    // render "C = SA" instead — match loosely so this doesn't depend on the local openssl build.
    const text = csrText(csrPem).replace(/\s*=\s*/g, "=");
    expect(text).toContain("C=SA");
    expect(text).toContain("OU=Riyadh Branch");
    expect(text).toContain("O=Maximum Speed Tech Supply LTD");
    expect(text).toContain("CN=Till-1");
  });

  it("carries the certificateTemplateName extension with the given template", () => {
    const text = csrText(csrPem);
    expect(text).toContain("1.3.6.1.4.1.311.20.2");
    expect(text).toContain("TSTZATCA-Code-Signing");
  });

  it("carries the SAN directoryName with EGS serial, VAT number, invoice type, location, and industry", () => {
    const text = csrText(csrPem);
    expect(text).toContain("X509v3 Subject Alternative Name");
    expect(text).toContain("1-MarkazPOS|2-M1|3-ed22f1d8-e6a2-1118-9b58-d9a8f11e445f");
    expect(text).toContain("399999999900003");
    expect(text).toContain("1100");
    expect(text).toContain("RRRD2929");
    expect(text).toContain("Retail");
  });

  it("re-signing an existing key (a renewal) reuses that same key", () => {
    const renewed = generateCsr(privateKeyPem, { ...baseInput, commonName: "Till-1-renewed" });
    const dir = mkdtempSync(join(tmpdir(), "zatca-csr-test-"));
    try {
      const keyPath = join(dir, "key.pem");
      writeFileSync(keyPath, privateKeyPem);
      const expectedPub = execFileSync("openssl", ["ec", "-in", keyPath, "-pubout"], { encoding: "utf8", env: OPENSSL_ENV });
      const renewedPub = execFileSync("openssl", ["req", "-pubkey", "-noout"], { input: renewed.csrPem, encoding: "utf8", env: OPENSSL_ENV });
      expect(renewedPub).toBe(expectedPub);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
