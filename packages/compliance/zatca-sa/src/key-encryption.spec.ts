import { KeyEncryptionError, decryptSecret, decryptText, encryptSecret, encryptText, loadEncryptionKey } from "./key-encryption.js";

const KEY = Buffer.from("x".repeat(32), "utf8"); // 32 raw bytes, a valid key for these tests

describe("key encryption (docs/09-SECURITY-RULES.md §5)", () => {
  it("round-trips a secret", () => {
    const plaintext = Buffer.from("super secret CSID", "utf8");
    const packed = encryptSecret(plaintext, KEY);
    expect(decryptSecret(packed, KEY)).toEqual(plaintext);
  });

  it("round-trips text", () => {
    const packed = encryptText("-----BEGIN EC PRIVATE KEY-----\nabc\n-----END EC PRIVATE KEY-----", KEY);
    expect(decryptText(packed, KEY)).toBe("-----BEGIN EC PRIVATE KEY-----\nabc\n-----END EC PRIVATE KEY-----");
  });

  it("never stores the plaintext anywhere in the packed bytes", () => {
    const plaintext = Buffer.from("findable-marker-xyz", "utf8");
    const packed = encryptSecret(plaintext, KEY);
    expect(packed.includes("findable-marker-xyz")).toBe(false);
  });

  it("produces different ciphertext for the same plaintext each time (random IV)", () => {
    const plaintext = Buffer.from("same plaintext", "utf8");
    const a = encryptSecret(plaintext, KEY);
    const b = encryptSecret(plaintext, KEY);
    expect(a.equals(b)).toBe(false);
  });

  it("refuses to decrypt with the wrong key", () => {
    const packed = encryptSecret(Buffer.from("secret"), KEY);
    const wrongKey = Buffer.from("y".repeat(32), "utf8");
    expect(() => decryptSecret(packed, wrongKey)).toThrow(KeyEncryptionError);
  });

  it("refuses to decrypt a tampered ciphertext (GCM auth tag catches it)", () => {
    const packed = encryptSecret(Buffer.from("secret"), KEY);
    const tampered = Buffer.from(packed);
    const lastByte = tampered.length - 1;
    tampered[lastByte] = (tampered[lastByte] ?? 0) ^ 0xff; // flip a bit inside the auth tag
    expect(() => decryptSecret(tampered, KEY)).toThrow(KeyEncryptionError);
  });

  it("refuses a value too short to even contain an IV and auth tag", () => {
    expect(() => decryptSecret(Buffer.from("short"), KEY)).toThrow(KeyEncryptionError);
  });

  describe("loadEncryptionKey", () => {
    const ENV_VAR = "ZATCA_KEY_ENCRYPTION_KEY_TEST";
    afterEach(() => {
      delete process.env[ENV_VAR];
    });

    it("decodes a valid base64 32-byte key", () => {
      const key = Buffer.from("z".repeat(32), "utf8");
      process.env[ENV_VAR] = key.toString("base64");
      expect(loadEncryptionKey(ENV_VAR).equals(key)).toBe(true);
    });

    it("refuses when the env var is not set", () => {
      expect(() => loadEncryptionKey(ENV_VAR)).toThrow(KeyEncryptionError);
    });

    it("refuses a key of the wrong length", () => {
      process.env[ENV_VAR] = Buffer.from("too short").toString("base64");
      expect(() => loadEncryptionKey(ENV_VAR)).toThrow(KeyEncryptionError);
    });
  });
});
