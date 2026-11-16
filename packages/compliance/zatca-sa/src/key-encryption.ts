// Envelope encryption for ZATCA key material (private keys, CSIDs, secrets) —
// docs/09-SECURITY-RULES.md §5 / docs/06-COMPLIANCE-PACK-RULES.md §5: never plaintext in the
// database, never logged, never returned by an API. The decryption key is held outside the
// database (an environment variable injected into the container at runtime, per
// docs/09 §5 — "otherwise a strong local encryption scheme with the decryption key held
// outside the database"; this deployment has no KMS).
//
// Format: one Buffer per secret, laid out as [12-byte IV][ciphertext][16-byte GCM auth tag].
// AES-256-GCM is authenticated: a tampered or truncated ciphertext fails to decrypt rather
// than silently returning wrong bytes.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 12; // 96 bits, the recommended GCM nonce size
const AUTH_TAG_LENGTH = 16;

export class KeyEncryptionError extends Error {
  constructor(
    readonly code: "KEY_NOT_CONFIGURED" | "KEY_WRONG_LENGTH" | "CIPHERTEXT_TOO_SHORT" | "DECRYPTION_FAILED",
    message: string,
  ) {
    super(message);
    this.name = "KeyEncryptionError";
  }
}

// Reads and validates the encryption key from the given environment variable (not cached:
// each call re-reads process.env, so a key rotation that restarts the process is picked up
// without requiring a code change). The value must be 32 raw bytes, base64-encoded.
export function loadEncryptionKey(envVarName = "ZATCA_KEY_ENCRYPTION_KEY"): Buffer {
  const value = process.env[envVarName];
  if (!value) {
    throw new KeyEncryptionError("KEY_NOT_CONFIGURED", `${envVarName} is not set — see .env.example.`);
  }
  const key = Buffer.from(value, "base64");
  if (key.length !== KEY_LENGTH) {
    throw new KeyEncryptionError("KEY_WRONG_LENGTH", `${envVarName} must decode to exactly ${KEY_LENGTH} bytes (got ${key.length}).`);
  }
  return key;
}

export function encryptSecret(plaintext: Uint8Array, key: Buffer): Buffer {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, ciphertext, authTag]);
}

// Accepts `Uint8Array`, not just `Buffer`: a value read back from a Prisma Bytes column comes
// typed as `Uint8Array<ArrayBuffer>` (current @types/node parameterizes `Buffer` more broadly,
// over `ArrayBufferLike`, so the two are no longer the same type even though every Buffer IS a
// Uint8Array at runtime) — callers like onboarding.service.ts pass a Prisma-read value straight
// through without needing their own cast.
export function decryptSecret(packed: Uint8Array, key: Buffer): Buffer {
  if (packed.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new KeyEncryptionError("CIPHERTEXT_TOO_SHORT", "Encrypted value is shorter than an IV + auth tag — corrupt or not one of ours.");
  }
  const buf = Buffer.isBuffer(packed) ? packed : Buffer.from(packed.buffer, packed.byteOffset, packed.byteLength);
  const iv = buf.subarray(0, IV_LENGTH);
  const authTag = buf.subarray(buf.length - AUTH_TAG_LENGTH);
  const ciphertext = buf.subarray(IV_LENGTH, buf.length - AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    // node:crypto's own error message carries no key material, but wrap anyway so a caller
    // that logs a caught error can never accidentally include ciphertext bytes from the cause.
    throw new KeyEncryptionError("DECRYPTION_FAILED", "Could not decrypt — wrong key, or the value was tampered with.");
  }
}

export function encryptText(plaintext: string, key: Buffer): Buffer {
  return encryptSecret(Buffer.from(plaintext, "utf8"), key);
}

export function decryptText(packed: Uint8Array, key: Buffer): string {
  return decryptSecret(packed, key).toString("utf8");
}
