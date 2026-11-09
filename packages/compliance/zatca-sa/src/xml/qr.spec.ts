import { buildQrBase64, buildQrTlv } from "./qr.js";

// Field values and the expected result below were decoded byte-for-byte from the official SDK's
// own signed samples (docs/vendor/zatca/sdk/Data/Samples) — ground truth, not invented. This is
// what caught tags 6/7 actually being UTF-8 text of a base64 string rather than raw bytes.
const PUBLIC_KEY_DER_HEX =
  "3056301006072a8648ce3d020106052b8104000a03420004a1608a6b449af45204ad33afd2e0240b5548297c54f673e9c76be57f8ca131e8f2f1cd365c96e50eaeed3f2768f26ab46a138c98da3c8309e2ed7b75293f5478";

describe("buildQrBase64 — reproduces the official SDK sample's own QR byte-for-byte", () => {
  it("matches Standard_Invoice.xml's embedded QR", () => {
    const qr = buildQrBase64({
      sellerName: "شركة توريد التكنولوجيا بأقصى سرعة المحدودة | Maximum Speed Tech Supply LTD",
      vatNumber: "399999999900003",
      timestamp: "2022-09-07T12:21:28",
      invoiceTotalWithVat: "4.60",
      vatTotal: "0.6",
      invoiceHashBase64: "V4U5qlZ3yXQ/Si1AC/R8SLc3F+iNy27wdVe8IWRqFAQ=",
      signatureBase64: "MEUCIQCP9/y0oNgY+oIZyBMGx0eCRvcEKHsGybjFrneJlYVkwQIgBjyffZRZUD797Zs/bW2k027C6mDMMtVreOLhDmP+tz0=",
      publicKeyDer: Buffer.from(PUBLIC_KEY_DER_HEX, "hex"),
    });
    expect(qr).toBe(
      "AW/YtNix2YPYqSDYqtmI2LHZitivINin2YTYqtmD2YbZiNmE2YjYrNmK2Kcg2KjYo9mC2LXZiSDYs9ix2LnYqSDYp9mE2YXYrdiv2YjYr9ipIHwgTWF4aW11bSBTcGVlZCBUZWNoIFN1cHBseSBMVEQCDzM5OTk5OTk5OTkwMDAwMwMTMjAyMi0wOS0wN1QxMjoyMToyOAQENC42MAUDMC42BixWNFU1cWxaM3lYUS9TaTFBQy9SOFNMYzNGK2lOeTI3d2RWZThJV1JxRkFRPQdgTUVVQ0lRQ1A5L3kwb05nWStvSVp5Qk1HeDBlQ1J2Y0VLSHNHeWJqRnJuZUpsWVZrd1FJZ0JqeWZmWlJaVUQ3OTdacy9iVzJrMDI3QzZtRE1NdFZyZU9MaERtUCt0ejA9CFgwVjAQBgcqhkjOPQIBBgUrgQQACgNCAAShYIprRJr0UgStM6/S4CQLVUgpfFT2c+nHa+V/jKEx6PLxzTZcluUOru0/J2jyarRqE4yY2jyDCeLte3UpP1R4",
    );
  });

  it("matches Simplified_Invoice.xml's embedded QR, including the certificate signature (tag 9)", () => {
    const qr = buildQrBase64({
      sellerName: "شركة توريد التكنولوجيا بأقصى سرعة المحدودة | Maximum Speed Tech Supply LTD",
      vatNumber: "399999999900003",
      timestamp: "2022-08-17T17:41:08",
      invoiceTotalWithVat: "231.15",
      vatTotal: "30.15",
      invoiceHashBase64: "z5F9qsS6oWyDhehD8u8S0DaxV+2CUiUz9Y+UsR61JgQ=",
      signatureBase64: "MEYCIQCYovp/Gxd/x2qZcDZZf+4TdtfZjU/1/fzS3EQjmZGhlQIhANTc0rlAs3ffQgrKi8V49eXV32d200XIutgCti4iGAjB",
      publicKeyDer: Buffer.from(PUBLIC_KEY_DER_HEX, "hex"),
      certificateSignatureDer: Buffer.from(
        "3045022100b13f89c8669d65c250a51b71adf2722f28ab068bbc574756342bbde23dbaa01b02203d842e0cf2380c0400cf4b399ddae88f240ea0291dcb134dd4ef97aa6c2feb5c",
        "hex",
      ),
    });
    expect(qr).toBe(
      "AW/YtNix2YPYqSDYqtmI2LHZitivINin2YTYqtmD2YbZiNmE2YjYrNmK2Kcg2KjYo9mC2LXZiSDYs9ix2LnYqSDYp9mE2YXYrdiv2YjYr9ipIHwgTWF4aW11bSBTcGVlZCBUZWNoIFN1cHBseSBMVEQCDzM5OTk5OTk5OTkwMDAwMwMTMjAyMi0wOC0xN1QxNzo0MTowOAQGMjMxLjE1BQUzMC4xNQYsejVGOXFzUzZvV3lEaGVoRDh1OFMwRGF4VisyQ1VpVXo5WStVc1I2MUpnUT0HYE1FWUNJUUNZb3ZwL0d4ZC94MnFaY0RaWmYrNFRkdGZaalUvMS9melMzRVFqbVpHaGxRSWhBTlRjMHJsQXMzZmZRZ3JLaThWNDllWFYzMmQyMDBYSXV0Z0N0aTRpR0FqQghYMFYwEAYHKoZIzj0CAQYFK4EEAAoDQgAEoWCKa0Sa9FIErTOv0uAkC1VIKXxU9nPpx2vlf4yhMejy8c02XJblDq7tPydo8mq0ahOMmNo8gwni7Xt1KT9UeAlHMEUCIQCxP4nIZp1lwlClG3Gt8nIvKKsGi7xXR1Y0K73iPbqgGwIgPYQuDPI4DAQAz0s5ndrojyQOoCkdyxNN1O+Xqmwv61w=",
    );
  });
});

describe("buildQrTlv — field encoding", () => {
  it("rejects a value longer than 255 bytes (single-byte TLV length)", () => {
    expect(() =>
      buildQrTlv({
        sellerName: "x".repeat(256),
        vatNumber: "399999999900003",
        timestamp: "2026-11-04T00:00:00",
        invoiceTotalWithVat: "1.00",
        vatTotal: "0.00",
        invoiceHashBase64: "x",
        signatureBase64: "x",
        publicKeyDer: Buffer.from([]),
      }),
    ).toThrow(RangeError);
  });

  it("omits tag 9 when no certificate signature is given (standard invoices), and includes it when given", () => {
    const parseTags = (buf: Buffer): number[] => {
      const tags: number[] = [];
      let i = 0;
      while (i < buf.length) {
        tags.push(buf[i]!);
        i += 2 + buf[i + 1]!;
      }
      return tags;
    };
    const fields = {
      sellerName: "Seller",
      vatNumber: "399999999900003",
      timestamp: "2026-11-04T00:00:00",
      invoiceTotalWithVat: "1.00",
      vatTotal: "0.00",
      invoiceHashBase64: "x",
      signatureBase64: "x",
      publicKeyDer: Buffer.from([1, 2, 3]),
    };
    expect(parseTags(buildQrTlv(fields))).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(parseTags(buildQrTlv({ ...fields, certificateSignatureDer: Buffer.from([9, 9]) }))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});
