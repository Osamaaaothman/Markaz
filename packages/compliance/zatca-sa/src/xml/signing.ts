// ECDSA (secp256k1, SHA-256) signing and the two pieces of a certificate the QR code and the
// XAdES signature both need: its public key (DER SubjectPublicKeyInfo) and its own signature
// bytes (the issuing CA's signature over this certificate — QR tag 9, simplified invoices only).
// All built on Node's built-in `node:crypto`, including secp256k1 ECDSA — no new dependency was
// needed for this part. Every piece here is verified byte-for-byte against the official SDK's
// own sample key/certificate (signing.spec.ts), not just "should work" reasoning.
import { X509Certificate, createPrivateKey, createPublicKey, sign as cryptoSign, verify as cryptoVerify, type KeyObject } from "node:crypto";

export class ZatcaSigningError extends Error {
  constructor(
    readonly code: "MALFORMED_CERTIFICATE",
    message: string,
  ) {
    super(message);
    this.name = "ZatcaSigningError";
  }
}

// node:crypto needs PEM armor; the ZATCA onboarding flow (Phase 2) will hold properly-armored
// PEM throughout, but the official SDK's own sample fixtures are raw base64 DER with no armor —
// this wraps either form consistently for anything that reads one of those fixtures.
export function toPem(base64OrPem: string, label: "CERTIFICATE" | "EC PRIVATE KEY" | "PRIVATE KEY"): string {
  const trimmed = base64OrPem.trim();
  if (trimmed.startsWith("-----BEGIN")) return trimmed.endsWith("\n") ? trimmed : `${trimmed}\n`;
  const lines = trimmed.match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----\n`;
}

export function signData(data: Buffer, privateKeyPem: string): Buffer {
  return cryptoSign("sha256", data, { key: createPrivateKey(privateKeyPem), dsaEncoding: "der" });
}

export function verifyData(data: Buffer, signatureDer: Buffer, publicKey: KeyObject | string): boolean {
  const key = typeof publicKey === "string" ? createPublicKey(publicKey) : publicKey;
  return cryptoVerify("sha256", data, { key, dsaEncoding: "der" }, signatureDer);
}

export function extractPublicKeyDer(certificatePem: string): Buffer {
  return new X509Certificate(certificatePem).publicKey.export({ type: "spki", format: "der" });
}

export function publicKeyOf(certificatePem: string): KeyObject {
  return new X509Certificate(certificatePem).publicKey;
}

// Minimal DER/TLV reader — not a general ASN.1 library, just enough to walk the fixed top-level
// shape of an X.509 certificate (SEQUENCE { tbsCertificate, signatureAlgorithm, signatureValue })
// and pull out the third element. This is OUR OWN certificate (issued to us, not adversarial
// input), so a targeted walker is the boring, explicit choice over a new general-purpose
// dependency — verified against the official sample certificate's own signature bytes.
function readDerLength(buf: Buffer, offset: number): { length: number; headerLength: number } {
  const first = buf[offset]!;
  if (first < 0x80) return { length: first, headerLength: 1 };
  const numBytes = first & 0x7f;
  let length = 0;
  for (let i = 0; i < numBytes; i++) length = (length << 8) | buf[offset + 1 + i]!;
  return { length, headerLength: 1 + numBytes };
}

function readDerTlv(buf: Buffer, offset: number): { tag: number; length: number; valueStart: number; totalLength: number } {
  const tag = buf[offset]!;
  const { length, headerLength } = readDerLength(buf, offset + 1);
  const valueStart = offset + 1 + headerLength;
  return { tag, length, valueStart, totalLength: 1 + headerLength + length };
}

const SEQUENCE_TAG = 0x30;
const BIT_STRING_TAG = 0x03;

// Returns the raw DER-encoded ECDSA signature (an ASN.1 SEQUENCE of two INTEGERs) that the
// issuing CA signed this certificate with — the bytes QR tag 9 carries, for a simplified
// invoice's EGS certificate.
export function extractCertificateSignatureDer(certificateDer: Buffer): Buffer {
  const top = readDerTlv(certificateDer, 0);
  if (top.tag !== SEQUENCE_TAG) {
    throw new ZatcaSigningError("MALFORMED_CERTIFICATE", "Not a DER-encoded X.509 certificate (expected a top-level SEQUENCE)");
  }
  const children: ReturnType<typeof readDerTlv>[] = [];
  let pos = top.valueStart;
  while (pos < top.valueStart + top.length) {
    const child = readDerTlv(certificateDer, pos);
    children.push(child);
    pos += child.totalLength;
  }
  const signatureValue = children[2];
  if (children.length !== 3 || !signatureValue || signatureValue.tag !== BIT_STRING_TAG) {
    throw new ZatcaSigningError("MALFORMED_CERTIFICATE", "Expected exactly 3 top-level fields ending in a BIT STRING signatureValue");
  }
  // A BIT STRING's first content byte is the count of unused trailing bits — 0 for a DER
  // signature, which is always a whole number of bytes.
  const unusedBits = certificateDer[signatureValue.valueStart];
  if (unusedBits !== 0) {
    throw new ZatcaSigningError("MALFORMED_CERTIFICATE", `Expected 0 unused bits in the signature BIT STRING, got ${String(unusedBits)}`);
  }
  return certificateDer.subarray(signatureValue.valueStart + 1, signatureValue.valueStart + signatureValue.length);
}
