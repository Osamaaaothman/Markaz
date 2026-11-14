import { X509Certificate } from "node:crypto";

export type CertInfo = X509Certificate;

// The API's binarySecurityToken is an authentication credential, not necessarily
// base64 DER: the sandbox returns base64 of the base64 certificate text. Existing
// credentials store that token inside PEM armor. Decode only for cryptographic
// use; the original token must still be sent unchanged as the Basic-auth username.
// OpenSSL parses the complete certificate, including its extensions. Do not bypass
// X.509 parsing with a permissive DER walker when an input is malformed.
export function parseCertificate(pemOrBase64: string): CertInfo {
  const body = pemOrBase64.trim()
    .replace(/^-----BEGIN CERTIFICATE-----\s*([\s\S]*?)\s*-----END CERTIFICATE-----$/, "$1")
    .replace(/\s/g, "");
  const decoded = Buffer.from(body, "base64");
  if (decoded[0] === 0x30) return new X509Certificate(decoded);

  // One additional transport layer only: do not recursively decode arbitrary data.
  const certificateText = decoded.toString("utf8").trim();
  if (certificateText.startsWith("-----BEGIN CERTIFICATE-----")) {
    return new X509Certificate(certificateText);
  }
  return new X509Certificate(Buffer.from(certificateText, "base64"));
}
