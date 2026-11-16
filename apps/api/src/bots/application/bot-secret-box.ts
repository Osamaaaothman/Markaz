import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// AES-256-GCM for chat bot credentials at rest (docs/09-SECURITY-RULES.md §5): never plaintext in
// the database, never logged, never returned by an API. Same construction as the ZATCA key store
// (packages/compliance/zatca-sa/src/key-encryption.ts): [12-byte IV][ciphertext][16-byte tag].
// It is not shared through @erp/shared on purpose — that package is also bundled into the
// browser app, which cannot load node:crypto.

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

export class BotKeyError extends Error {
  constructor(
    readonly code: "KEY_NOT_CONFIGURED" | "KEY_WRONG_LENGTH" | "CIPHERTEXT_TOO_SHORT" | "DECRYPTION_FAILED",
    message: string,
  ) {
    super(message);
    this.name = "BotKeyError";
  }
}

// Re-read on every call: a key rotation that restarts the process needs no code change, and the
// key is never kept in a long-lived object.
export function loadKey(envVarName: string): Buffer {
  const value = process.env[envVarName];
  if (!value) throw new BotKeyError("KEY_NOT_CONFIGURED", `${envVarName} is not set`);
  const key = Buffer.from(value, "base64");
  if (key.length !== KEY_LENGTH) throw new BotKeyError("KEY_WRONG_LENGTH", `${envVarName} must decode to ${KEY_LENGTH} bytes`);
  return key;
}

export function sealText(plaintext: string, key: Buffer): Buffer {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(plaintext, "utf8")), cipher.final()]);
  return Buffer.concat([iv, ciphertext, cipher.getAuthTag()]);
}

export function openText(packed: Uint8Array, key: Buffer): string {
  if (packed.length < IV_LENGTH + TAG_LENGTH) throw new BotKeyError("CIPHERTEXT_TOO_SHORT", "Encrypted value is too short");
  const buf = Buffer.from(packed.buffer, packed.byteOffset, packed.byteLength);
  const decipher = createDecipheriv(ALGORITHM, key, buf.subarray(0, IV_LENGTH));
  decipher.setAuthTag(buf.subarray(buf.length - TAG_LENGTH));
  try {
    return Buffer.concat([decipher.update(buf.subarray(IV_LENGTH, buf.length - TAG_LENGTH)), decipher.final()]).toString("utf8");
  } catch {
    // Never include ciphertext or key material in the error.
    throw new BotKeyError("DECRYPTION_FAILED", "Could not decrypt — wrong key, or the value was tampered with");
  }
}
