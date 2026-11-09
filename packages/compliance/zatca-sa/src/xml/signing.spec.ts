import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { extractCertificateSignatureDer, extractPublicKeyDer, publicKeyOf, signData, toPem, verifyData, ZatcaSigningError } from "./signing.js";
import { SDK_CERTS, describeIfSdk } from "../testing/fixtures.js";


describe("toPem", () => {
  it("wraps raw base64 with the given label, 64 characters per line", () => {
    const pem = toPem("ABCD".repeat(50), "CERTIFICATE");
    expect(pem.startsWith("-----BEGIN CERTIFICATE-----\n")).toBe(true);
    expect(pem.trimEnd().endsWith("-----END CERTIFICATE-----")).toBe(true);
    expect(pem.split("\n")[1]).toHaveLength(64);
  });

  it("passes already-armored PEM through unchanged (besides a trailing newline)", () => {
    const armored = "-----BEGIN CERTIFICATE-----\nABCD\n-----END CERTIFICATE-----";
    expect(toPem(armored, "CERTIFICATE")).toBe(`${armored}\n`);
  });
});

describe("sign/verify — secp256k1 ECDSA-SHA256 round trip", () => {
  // A freshly generated secp256k1 key pair, independent of the SDK fixture, so this test suite
  // still proves the crypto primitives work even where the SDK isn't present.
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "secp256k1" });

  it("verifies a signature made with the matching private key", () => {
    const data = Buffer.from("an invoice's canonicalized SignedInfo, for example");
    const signature = signData(data, privateKey.export({ type: "pkcs8", format: "pem" }).toString());
    expect(verifyData(data, signature, publicKey)).toBe(true);
  });

  it("refuses a signature once the signed data changes", () => {
    const data = Buffer.from("original");
    const signature = signData(data, privateKey.export({ type: "pkcs8", format: "pem" }).toString());
    expect(verifyData(Buffer.from("tampered"), signature, publicKey)).toBe(false);
  });
});

// Ground truth from the official SDK's own sample key/certificate pair
// (docs/vendor/zatca/sdk/Data/Certificates) — not just "this should work" reasoning.
describeIfSdk("verified against the official SDK's sample key and certificate", () => {
  const certPem = toPem(readFileSync(join(SDK_CERTS, "cert.pem"), "utf8"), "CERTIFICATE");
  const privateKeyPem = toPem(readFileSync(join(SDK_CERTS, "ec-secp256k1-priv-key.pem"), "utf8"), "EC PRIVATE KEY");

  it("extracts the exact SubjectPublicKeyInfo the official QR sample's tag 8 carries", () => {
    const der = extractPublicKeyDer(certPem);
    expect(der.toString("hex")).toBe(
      "3056301006072a8648ce3d020106052b8104000a03420004a1608a6b449af45204ad33afd2e0240b5548297c54f673e9c76be57f8ca131e8f2f1cd365c96e50eaeed3f2768f26ab46a138c98da3c8309e2ed7b75293f5478",
    );
  });

  it("extracts the exact certificate signature the official simplified-invoice QR sample's tag 9 carries", () => {
    const der = extractCertificateSignatureDer(Buffer.from(readFileSync(join(SDK_CERTS, "cert.pem"), "utf8").trim(), "base64"));
    expect(der.toString("hex")).toBe(
      "3045022100b13f89c8669d65c250a51b71adf2722f28ab068bbc574756342bbde23dbaa01b02203d842e0cf2380c0400cf4b399ddae88f240ea0291dcb134dd4ef97aa6c2feb5c",
    );
  });

  it("signs with the sample private key and verifies against the sample certificate's public key", () => {
    const data = Buffer.from("whatever this phase eventually signs, the mechanism is the same");
    const signature = signData(data, privateKeyPem);
    expect(verifyData(data, signature, publicKeyOf(certPem))).toBe(true);
  });

  it("rejects a certificate that is not well-formed DER", () => {
    expect(() => extractCertificateSignatureDer(Buffer.from([0x02, 0x01, 0x01]))).toThrow(ZatcaSigningError);
  });
});
