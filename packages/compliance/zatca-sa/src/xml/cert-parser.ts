// ZATCA-compatible certificate parser.
//
// The ZATCA sandbox CA issues certificates with a double-wrapped SubjectKeyIdentifier
// extension (a non-standard DER encoding). OpenSSL 3.x — which backs Node.js 22's
// X509Certificate — rejects these with "asn1 encoding routines::wrong tag" (0x68/0xa8).
//
// This module tries X509Certificate first (the fast path, fully tested against the
// official SDK sample). When that fails, it falls back to a minimal DER walker that
// reads only TBSCertificate fields 0–6 (through subjectPublicKeyInfo) and never
// touches the extensions section — completely bypassing the encoding defect.
import { X509Certificate, createPublicKey, type KeyObject } from "node:crypto";

export interface CertInfo {
  readonly raw: Buffer | Uint8Array;
  readonly issuer: string;
  readonly serialNumber: string;
  readonly validFrom: string;
  readonly validTo: string;
  readonly publicKey: KeyObject;
}

// Primary entry point: same interface as X509Certificate, works for both valid certs
// and ZATCA sandbox certs with malformed extensions.
export function parseCertificate(pemOrBase64: string): CertInfo {
  const pem = pemOrBase64.trim().startsWith("-----BEGIN")
    ? pemOrBase64.trim().endsWith("\n")
      ? pemOrBase64
      : `${pemOrBase64}\n`
    : `-----BEGIN CERTIFICATE-----\n${pemOrBase64.match(/.{1,64}/g)?.join("\n") ?? ""}\n-----END CERTIFICATE-----\n`;

  try {
    return new X509Certificate(pem);
  } catch {
    // ZATCA sandbox cert has non-standard extensions — fall back to minimal DER parser.
    const base64 = pem.replace(/-----[^\n]+-----/g, "").replace(/\s/g, "");
    return parseDerCertificate(Buffer.from(base64, "base64"));
  }
}

// ── Minimal DER walker ───────────────────────────────────────────────────────

function readLen(buf: Buffer, at: number): { len: number; hdr: number } {
  const f = buf[at]!;
  if (f < 0x80) return { len: f, hdr: 1 };
  const n = f & 0x7f;
  let len = 0;
  for (let i = 0; i < n; i++) len = (len << 8) | buf[at + 1 + i]!;
  return { len, hdr: 1 + n };
}

function readTlv(buf: Buffer, at: number): { tag: number; vstart: number; end: number } {
  const tag = buf[at]!;
  const { len, hdr } = readLen(buf, at + 1);
  const vstart = at + 1 + hdr;
  return { tag, vstart, end: vstart + len };
}

function children(buf: Buffer, start: number, end: number) {
  const out: ReturnType<typeof readTlv>[] = [];
  let p = start;
  while (p < end) {
    const t = readTlv(buf, p);
    out.push(t);
    p = t.end;
  }
  return out;
}

function decodeOid(buf: Buffer, start: number, end: number): string {
  if (end <= start) return "";
  const first = buf[start]!;
  const parts: number[] = [Math.floor(first / 40), first % 40];
  let v = 0;
  for (let i = start + 1; i < end; i++) {
    const b = buf[i]!;
    v = (v << 7) | (b & 0x7f);
    if (!(b & 0x80)) { parts.push(v); v = 0; }
  }
  return parts.join(".");
}

const OID_NAMES: Record<string, string> = {
  "2.5.4.3": "CN",
  "2.5.4.4": "SN",
  "2.5.4.6": "C",
  "2.5.4.7": "L",
  "2.5.4.8": "ST",
  "2.5.4.10": "O",
  "2.5.4.11": "OU",
  "2.5.4.42": "GN",
  "0.9.2342.19200300.100.1.25": "DC",
  "0.9.2342.19200300.100.1.1": "UID",
  "1.2.840.113549.1.9.1": "emailAddress",
};

// Parses a Name SEQUENCE into Node.js X509Certificate.issuer-style string:
// each RDN on its own line, KEY=value, in DER order (issuerDistinguishedName()
// in xades-signature.ts then reverses this for the XML).
function parseName(buf: Buffer, start: number, end: number): string {
  const lines: string[] = [];
  let p = start;
  while (p < end) {
    const rdn = readTlv(buf, p); // SET
    let ap = rdn.vstart;
    while (ap < rdn.end) {
      const atv = readTlv(buf, ap); // SEQUENCE { OID, value }
      if (atv.tag === 0x30) {
        const kids = children(buf, atv.vstart, atv.end);
        if (kids.length >= 2) {
          const oidT = kids[0]!;
          const valT = kids[1]!;
          const oid = decodeOid(buf, oidT.vstart, oidT.end);
          const name = OID_NAMES[oid] ?? oid;
          let val: string;
          if (valT.tag === 0x1e) {
            // BMPString (UTF-16BE)
            val = buf.subarray(valT.vstart, valT.end).toString("utf16le");
          } else {
            val = buf.subarray(valT.vstart, valT.end).toString("utf8");
          }
          // RFC 4514 minimal escaping
          const esc = val
            .replace(/\\/g, "\\\\")
            .replace(/,/g, "\\,")
            .replace(/\+/g, "\\+")
            .replace(/"/g, '\\"')
            .replace(/</g, "\\<")
            .replace(/>/g, "\\>")
            .replace(/;/g, "\\;")
            .replace(/^([ #])/, "\\$1")
            .replace(/([ ])$/, "\\$1");
          lines.push(`${name}=${esc}`);
        }
      }
      ap = atv.end;
    }
    p = rdn.end;
  }
  return lines.join("\n");
}

function parseTime(buf: Buffer, tag: number, vstart: number, end: number): string {
  const s = buf.subarray(vstart, end).toString("ascii");
  if (tag === 0x17) {
    // UTCTime: YYMMDDHHMMSSZ
    const yr = parseInt(s.slice(0, 2)) >= 50 ? `19${s.slice(0, 2)}` : `20${s.slice(0, 2)}`;
    return `${yr}-${s.slice(2, 4)}-${s.slice(4, 6)}T${s.slice(6, 8)}:${s.slice(8, 10)}:${s.slice(10, 12)}Z`;
  }
  // GeneralizedTime: YYYYMMDDHHMMSSZ
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(8, 10)}:${s.slice(10, 12)}:${s.slice(12, 14)}Z`;
}

function parseDerCertificate(der: Buffer): CertInfo {
  // Certificate ::= SEQUENCE { tbsCertificate, signatureAlgorithm, signatureValue }
  const cert = readTlv(der, 0);
  const tbs = readTlv(der, cert.vstart);

  let p = tbs.vstart;

  // version [0] EXPLICIT INTEGER OPTIONAL
  if (der[p] === 0xa0) { const v = readTlv(der, p); p = v.end; }

  // serialNumber INTEGER
  const ser = readTlv(der, p); p = ser.end;
  let sb = der.subarray(ser.vstart, ser.end);
  if (sb[0] === 0x00) sb = sb.subarray(1); // strip sign byte
  const serialNumber = sb.toString("hex").toUpperCase();

  // signature AlgorithmIdentifier — skip
  const sigAlg = readTlv(der, p); p = sigAlg.end;

  // issuer Name
  const iss = readTlv(der, p); p = iss.end;
  const issuer = parseName(der, iss.vstart, iss.end);

  // validity SEQUENCE { notBefore, notAfter }
  const val = readTlv(der, p); p = val.end;
  const valKids = children(der, val.vstart, val.end);
  const nbT = valKids[0]!;
  const naT = valKids[1]!;
  const validFrom = parseTime(der, nbT.tag, nbT.vstart, nbT.end);
  const validTo = parseTime(der, naT.tag, naT.vstart, naT.end);

  // subject Name — skip
  const sub = readTlv(der, p); p = sub.end;

  // subjectPublicKeyInfo SEQUENCE — extract full TLV bytes, then create KeyObject
  const spkiStart = p;
  const spki = readTlv(der, p);
  const spkiDer = der.subarray(spkiStart, spki.end);
  const publicKey = createPublicKey({ key: spkiDer, format: "der", type: "spki" });

  // Extensions ([3]) deliberately not parsed — that is where ZATCA sandbox certs are broken.

  return { raw: der, issuer, serialNumber, validFrom, validTo, publicKey };
}
