import { DEFAULT_MAX_BYTES, HARD_MAX_BYTES } from "@erp/core";

export type AttachmentConfig =
  | { readonly provider: "LOCAL"; readonly maxBytes: number; readonly localDir: string }
  | {
      readonly provider: "CLOUDINARY";
      readonly maxBytes: number;
      readonly localDir: string;
      readonly cloudName: string;
      readonly apiKey: string;
      readonly apiSecret: string;
      readonly folder: string;
    };

// Reads the attachment settings from the environment. Local storage is the default, so a deployment with no
// settings at all still works. Choosing Cloudinary without all three credentials fails at startup with a clear
// message, never on the first upload (docs/12-OPS-AND-DEPLOYMENT.md section 9). The secret is read here and
// nowhere else, never logged, never sent to the browser.
export function parseAttachmentConfig(env: Readonly<Record<string, string | undefined>>): AttachmentConfig {
  const requested = Number.parseInt(env.ATTACHMENT_MAX_BYTES ?? "", 10);
  const maxBytes = Number.isFinite(requested) && requested > 0 ? Math.min(requested, HARD_MAX_BYTES) : DEFAULT_MAX_BYTES;
  const localDir = env.ATTACHMENT_LOCAL_DIR?.trim() || "/data/attachments";
  const provider = (env.ATTACHMENT_STORAGE ?? "local").trim().toLowerCase();

  if (provider === "local") return { provider: "LOCAL", maxBytes, localDir };
  if (provider !== "cloudinary") throw new Error(`ATTACHMENT_STORAGE must be "local" or "cloudinary", got "${provider}"`);

  const cloudName = env.CLOUDINARY_CLOUD_NAME?.trim();
  const apiKey = env.CLOUDINARY_API_KEY?.trim();
  const apiSecret = env.CLOUDINARY_API_SECRET?.trim();
  const missing = [
    ["CLOUDINARY_CLOUD_NAME", cloudName],
    ["CLOUDINARY_API_KEY", apiKey],
    ["CLOUDINARY_API_SECRET", apiSecret],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length > 0 || !cloudName || !apiKey || !apiSecret) {
    throw new Error(`ATTACHMENT_STORAGE=cloudinary needs ${missing.join(", ")} to be set`);
  }
  return { provider: "CLOUDINARY", maxBytes, localDir, cloudName, apiKey, apiSecret, folder: env.CLOUDINARY_FOLDER?.trim() || "markaz" };
}
