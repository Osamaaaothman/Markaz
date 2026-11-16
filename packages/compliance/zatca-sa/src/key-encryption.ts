// The AES-256-GCM envelope helper now lives in @erp/shared (packages/shared/src/secret-box.ts) so
// every secret kept in the database uses one implementation. This module keeps the ZATCA default
// key variable so existing callers stay unchanged.
import { loadEncryptionKey as loadKeyFromEnv } from "@erp/shared";

export { KeyEncryptionError, encryptSecret, decryptSecret, encryptText, decryptText } from "@erp/shared";

export function loadEncryptionKey(envVarName = "ZATCA_KEY_ENCRYPTION_KEY"): Buffer {
  return loadKeyFromEnv(envVarName);
}
