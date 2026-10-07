import { OWNER_RULES, OWNER_TYPES, STORAGE_KEY_PATTERN, detectContentType, isOwnerType, newStorageKey, sanitizeFileName } from "./attachment-rules.js";

const bytes = (...values: number[]): Uint8Array => Uint8Array.from([...values, ...new Array<number>(16).fill(0)]);

describe("detectContentType", () => {
  it("recognises PDF, PNG, JPEG and WebP by their first bytes", () => {
    expect(detectContentType(bytes(0x25, 0x50, 0x44, 0x46, 0x2d, 0x31))).toBe("application/pdf");
    expect(detectContentType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe("image/png");
    expect(detectContentType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(detectContentType(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50, 0]))).toBe("image/webp");
  });

  it("rejects a script, an executable, a zip and an empty or tiny buffer, whatever the name says", () => {
    expect(detectContentType(new TextEncoder().encode("<script>alert(1)</script>   "))).toBeNull();
    expect(detectContentType(bytes(0x4d, 0x5a, 0x90, 0x00))).toBeNull(); // Windows executable
    expect(detectContentType(bytes(0x50, 0x4b, 0x03, 0x04))).toBeNull(); // zip / docx / xlsx
    expect(detectContentType(new Uint8Array(0))).toBeNull();
    expect(detectContentType(Uint8Array.from([0x25, 0x50, 0x44, 0x46]))).toBeNull();
  });

  it("does not accept a RIFF file that is not WebP (a WAV)", () => {
    expect(detectContentType(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45, 0]))).toBeNull();
  });
});

describe("sanitizeFileName", () => {
  it("keeps a normal name and drops any folder part", () => {
    expect(sanitizeFileName("invoice 123.pdf", "pdf")).toBe("invoice 123.pdf");
    expect(sanitizeFileName("..\\..\\windows\\system32\\evil.pdf", "pdf")).toBe("evil.pdf");
    expect(sanitizeFileName("/etc/passwd", "pdf")).toBe("passwd");
  });

  it("removes control characters, bidi overrides and characters that break headers", () => {
    expect(sanitizeFileName("a‮b\u0000c\r\nd\".pdf", "pdf")).toBe("abcd.pdf");
  });

  it("never returns an empty or hidden name", () => {
    expect(sanitizeFileName("", "pdf")).toBe("document.pdf");
    expect(sanitizeFileName("   ", "png")).toBe("document.png");
    expect(sanitizeFileName("...", "jpg")).toBe("document.jpg");
    expect(sanitizeFileName(".htaccess", "pdf")).toBe("htaccess");
  });

  it("limits the length", () => {
    expect(sanitizeFileName(`${"x".repeat(500)}.pdf`, "pdf").length).toBeLessThanOrEqual(120);
  });

  it("keeps Arabic names", () => {
    expect(sanitizeFileName("فاتورة المورد.pdf", "pdf")).toBe("فاتورة المورد.pdf");
  });
});

describe("visibility rule", () => {
  it("makes everything private except item pictures", () => {
    const publicTypes = OWNER_TYPES.filter((type) => OWNER_RULES[type].visibility === "PUBLIC");
    expect(publicTypes).toEqual(["ITEM"]);
  });

  it("requires a read permission on the record for every owner type", () => {
    for (const type of OWNER_TYPES) expect(OWNER_RULES[type].readResource.length).toBeGreaterThan(0);
  });

  it("treats pictures as image-only and tied to the right to change the record", () => {
    expect(OWNER_RULES.ITEM).toMatchObject({ imageOnly: true, manage: { resource: "item", action: "update" } });
    expect(OWNER_RULES.COMPANY).toMatchObject({ visibility: "PRIVATE", imageOnly: true, manage: { resource: "company", action: "update" } });
    expect(OWNER_RULES.SALES_INVOICE.manage).toBeUndefined();
  });

  it("knows which owner types exist", () => {
    expect(isOwnerType("SALES_INVOICE")).toBe(true);
    expect(isOwnerType("company")).toBe(false);
    expect(isOwnerType("__proto__")).toBe(false);
  });
});

describe("storage key pattern", () => {
  const id = "0192f3a4-7b2c-7c3e-9d41-5a6b7c8d9e0f";
  it("accepts a shard folder and a file id, and nothing else", () => {
    expect(STORAGE_KEY_PATTERN.test(newStorageKey(id))).toBe(true);
    expect(newStorageKey(id)).toBe(`0f/${id}`);
    expect(STORAGE_KEY_PATTERN.test(`0f/../${id}`)).toBe(false);
    expect(STORAGE_KEY_PATTERN.test(`../../etc/passwd`)).toBe(false);
    expect(STORAGE_KEY_PATTERN.test(`0f/${id}.pdf`)).toBe(false);
    expect(STORAGE_KEY_PATTERN.test(`/0f/${id}`)).toBe(false);
    expect(STORAGE_KEY_PATTERN.test(`default-company/${id}`)).toBe(false);
  });
});
