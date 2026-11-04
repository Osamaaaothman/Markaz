// Generates the EGS's secp256k1 key pair and its PKCS#10 CSR via the `openssl` CLI (shelled out
// with execFileSync — array arguments, never a shell string, so nothing here is vulnerable to
// command injection; see docs/09-SECURITY-RULES.md §4). Node has no built-in CSR generator; the
// task's own brief names this as one of the two acceptable approaches ("Use OpenSSL ... or a
// reliable library"), and docs/09 §8 only requires asking before a new *npm* dependency —
// `openssl` is a system binary already linked into Node's own TLS stack, listed explicitly in
// apps/api/Dockerfile (bookworm-slim's runtime image does not install the standalone CLI tool by
// default).
//
// CSR subject/SAN field meanings and OIDs cross-checked against two independent sources: the
// official Security Features Implementation Standard's "Table 1: CSR Subject field content"
// (docs/vendor/zatca/Security-Features-Implementation-Standards-v1.2.pdf) and a Microsoft
// Dynamics 365 onboarding guide's complete worked openssl.cnf example
// (https://learn.microsoft.com/en-us/dynamics365/finance/localizations/mea/gs-e-invoicing-sa-onboarding,
// fetched 2026-11-05) — not from memory. One real discrepancy found and resolved, see the SAN
// `SN` field's own comment below.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export class CsrGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CsrGenerationError";
  }
}

export interface CsrInput {
  // Free text per the Security Standard's own table ("Unique Name or Asset Tracking Number of
  // the Solution Unit provided by the Taxpayer") — no fixed format is required. The SDK's own
  // sample CSR configs reuse an arbitrary descriptive string here; Microsoft's guide reuses the
  // certificate template name itself for non-production environments, which is also acceptable.
  readonly commonName: string;
  // Free text for a normal taxpayer; for a VAT group, the 10-digit TIN of the individual member
  // being onboarded (docs/vendor Security Standard table — not implemented here: VAT-group
  // membership is a Company/EgsUnit-level business decision outside this module's scope).
  readonly organizationUnit: string;
  readonly organizationName: string;
  readonly countryCode: string; // ISO 3166-1 alpha-2, "SA"
  // "1-<solution/manufacturer name>|2-<model/version>|3-<serial>" — EgsUnit.serial.
  readonly egsSerial: string;
  readonly vatNumber: string; // 15 digits, starts and ends with "3"
  // The 4-digit TSCZ invoice-type flags, e.g. "1100" — matches ZATCA_INVOICE_TYPE_NAME's digits.
  readonly invoiceTypeDigits: string;
  readonly location: string; // registeredAddress — free text, preferably the Short Address
  readonly businessCategory: string; // industry/sector, free text
  readonly certificateTemplateName: string; // ZATCA_CSR_CERTIFICATE_TEMPLATE[environment]
}

export interface GeneratedKeyAndCsr {
  readonly privateKeyPem: string;
  readonly csrPem: string;
}

function runOpenssl(args: readonly string[]): string {
  try {
    return execFileSync("openssl", args, { encoding: "utf8" });
  } catch (error) {
    const stderr = error && typeof error === "object" && "stderr" in error ? String(error.stderr) : "";
    throw new CsrGenerationError(`openssl ${args[0]} failed: ${stderr || (error instanceof Error ? error.message : String(error))}`);
  }
}

// Builds an openssl config with exactly one extensions section (named v3_req, referenced both by
// `distinguished_name`'s sibling `req_extensions` key AND the `-extensions v3_req` CLI flag) —
// deliberately NOT structured the way some community/vendor sample configs are, which define a
// `[req_ext]` section containing the real extensions but then invoke `openssl req` with
// `-extensions v3_req` pointing at a DIFFERENT, nearly-empty section — a mismatch that silently
// drops subjectAltName and certificateTemplateName from the generated CSR. One section, one name,
// referenced consistently, so there is no section for the real content to go missing from.
function buildCsrConfig(input: CsrInput): string {
  return [
    "oid_section = OIDs",
    "",
    "[OIDs]",
    "certificateTemplateName = 1.3.6.1.4.1.311.20.2",
    "",
    "[req]",
    "default_md = sha256",
    "prompt = no",
    "req_extensions = v3_req",
    "distinguished_name = dn",
    "utf8 = yes",
    "string_mask = utf8only",
    "",
    "[dn]",
    `C = ${input.countryCode}`,
    `OU = ${input.organizationUnit}`,
    `O = ${input.organizationName}`,
    `CN = ${input.commonName}`,
    "",
    "[v3_req]",
    "basicConstraints = CA:FALSE",
    "keyUsage = digitalSignature, nonRepudiation, keyEncipherment",
    `certificateTemplateName = ASN1:PRINTABLESTRING:${input.certificateTemplateName}`,
    "subjectAltName = dirName:alt_names",
    "",
    // `subjectAltName = dirName:alt_names` means "one GeneralName of type dirName, whose RDN
    // sequence is the section named alt_names" — so [alt_names] holds the RDN attributes
    // directly; it must NOT itself contain a nested `dirName = ...` indirection (OpenSSL then
    // tries to parse "dirName" as an X.509 attribute type and fails with a cryptic "invalid
    // field name" error, which is exactly what the first version of this function did).
    "[alt_names]",
    // EGS serial. Per the Security Standard's own table this is x509.alternative_names (GUID) —
    // not formally "surname" — but every corroborating source (the SDK's own tooling conventions,
    // the task's own brief, and a Microsoft reference implementation) encodes it under the
    // shorthand attribute key "SN", which OpenSSL's standard object database resolves to
    // `surname` (2.5.4.4), not `serialNumber` (2.5.4.5). This looks like a semantic mismatch
    // against strict X.520 naming, but it is the attribute ZATCA's own validator is reported to
    // actually expect — followed here as the real, empirically-established convention rather
    // than a "more correct" OID nothing confirms ZATCA accepts.
    `SN = ${input.egsSerial}`,
    `UID = ${input.vatNumber}`,
    `title = ${input.invoiceTypeDigits}`,
    `registeredAddress = ${input.location}`,
    `businessCategory = ${input.businessCategory}`,
    "",
  ].join("\n");
}

export function generateEcPrivateKeyPem(): string {
  const dir = mkdtempSync(join(tmpdir(), "zatca-csr-"));
  try {
    const keyPath = join(dir, "private-key.pem");
    runOpenssl(["ecparam", "-name", "secp256k1", "-genkey", "-noout", "-out", keyPath]);
    return readFileSync(keyPath, "utf8");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function generateCsr(privateKeyPem: string, input: CsrInput): GeneratedKeyAndCsr {
  const dir = mkdtempSync(join(tmpdir(), "zatca-csr-"));
  try {
    const keyPath = join(dir, "private-key.pem");
    const configPath = join(dir, "csr.cnf");
    const csrPath = join(dir, "request.csr");
    writeFileSync(keyPath, privateKeyPem, { mode: 0o600 });
    writeFileSync(configPath, buildCsrConfig(input));
    runOpenssl(["req", "-new", "-sha256", "-key", keyPath, "-config", configPath, "-extensions", "v3_req", "-out", csrPath, "-utf8"]);
    return { privateKeyPem, csrPem: readFileSync(csrPath, "utf8") };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Convenience: generate the key and its CSR together, for the common case where no existing key
// is being reused (e.g. a renewal that intentionally keeps the same key would call
// `generateCsr` directly with the stored key instead).
export function generateKeyAndCsr(input: CsrInput): GeneratedKeyAndCsr {
  return generateCsr(generateEcPrivateKeyPem(), input);
}
