import { X509Certificate } from "node:crypto";
import { generateTestCertificate } from "../testing/fixtures.js";
import { parseCertificate } from "./cert-parser.js";
import { toPem } from "./signing.js";

describe("parseCertificate", () => {
  const fixture = generateTestCertificate();
  const expected = new X509Certificate(fixture.certificatePem);
  const token = Buffer.from(fixture.certificateBase64, "utf8").toString("base64");

  it.each([
    ["PEM", fixture.certificatePem],
    ["base64 DER", fixture.certificateBase64],
    ["binarySecurityToken", token],
    ["stored armored token", toPem(token, "CERTIFICATE")],
    ["base64 PEM", Buffer.from(fixture.certificatePem, "utf8").toString("base64")],
    ["CRLF PEM", fixture.certificatePem.replace(/\n/g, "\r\n")],
  ])("reads %s without changing the certificate bytes or metadata", (_label, value) => {
    const cert = parseCertificate(value);
    expect(cert.raw).toEqual(expected.raw);
    expect(cert.publicKey.equals(expected.publicKey)).toBe(true);
    expect(cert.issuer).toBe(expected.issuer);
    expect(cert.serialNumber).toBe(expected.serialNumber);
    expect(cert.validTo).toBe(expected.validTo);
  });

  it.each(["", "not-a-certificate", "MAA=", "MAMCAQE=", Buffer.from(token).toString("base64")])(
    "rejects malformed or excessively wrapped input without bypassing X.509 parsing (%#)", (value) => {
      expect(() => parseCertificate(value)).toThrow();
    },
  );
});
