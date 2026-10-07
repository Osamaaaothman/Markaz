import { createHash } from "node:crypto";
import { StorageError, type IFileStorage, type PutFileInput, type StoredFile } from "./file-storage.js";
import type { AttachmentVisibility } from "./attachment-rules.js";

export interface CloudinaryConfig {
  readonly cloudName: string;
  readonly apiKey: string;
  readonly apiSecret: string;
  // Folder prefix inside the account, so several deployments can share one account without mixing files.
  readonly folder: string;
  // Injectable for tests; defaults to the global fetch.
  readonly fetchImpl?: typeof fetch;
}

// The signing rule for API calls: the parameters being sent (except file, api_key, resource_type and cloud_name),
// sorted by name and joined as name=value with &, then the API secret appended, SHA-1, hex.
export function signCloudinaryParams(params: Readonly<Record<string, string | number>>, apiSecret: string): string {
  const toSign = Object.keys(params)
    .sort()
    .map((name) => `${name}=${params[name]}`)
    .join("&");
  return createHash("sha1")
    .update(toSign + apiSecret)
    .digest("hex");
}

// The signature inside a delivery URL for an "authenticated" asset: the first 8 characters of the URL-safe
// base64 of the SHA-1 of (path inside the account + secret).
export function signCloudinaryDeliveryPath(path: string, apiSecret: string): string {
  return createHash("sha1")
    .update(path + apiSecret)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .slice(0, 8);
}

const EXTENSIONS: Readonly<Record<string, string>> = { "application/pdf": "pdf", "image/png": "png", "image/webp": "webp", "image/jpeg": "jpg" };

// Written from the public Cloudinary documentation, unit-tested against a fake fetch, and verified against a real
// account on 2026-10-07 with packages/core/scripts/check-cloudinary.mjs (private round trip, no unsigned access,
// public picture, cleanup). Re-run that script after any change here or on a new Cloudinary account.
//
// Every file is stored as resource type "raw" so nothing is transformed or re-encoded, and the stored name carries
// the extension. Private files use delivery type "authenticated": there is no public link at all; the API server
// downloads through a signed URL and streams the bytes to a user who passed the permission check. Public files
// (item pictures only) use type "upload" and keep their permanent URL.
export class CloudinaryFileStorage implements IFileStorage {
  readonly provider = "CLOUDINARY" as const;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: CloudinaryConfig) {
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  private publicId(key: string, contentType: string): string {
    return `${this.config.folder}/${key}.${EXTENSIONS[contentType] ?? "bin"}`;
  }

  async put(input: PutFileInput): Promise<StoredFile> {
    const deliveryType = input.visibility === "PUBLIC" ? "upload" : "authenticated";
    const publicId = this.publicId(input.key, input.contentType);
    const timestamp = Math.floor(Date.now() / 1000);
    const form = new FormData();
    form.set("file", new Blob([Buffer.from(input.bytes)], { type: input.contentType }), "file");
    form.set("api_key", this.config.apiKey);
    form.set("timestamp", String(timestamp));
    form.set("public_id", publicId);
    form.set("type", deliveryType);
    form.set("signature", signCloudinaryParams({ public_id: publicId, timestamp, type: deliveryType }, this.config.apiSecret));

    const response = await this.fetchImpl(`https://api.cloudinary.com/v1_1/${this.config.cloudName}/raw/upload`, { method: "POST", body: form });
    if (!response.ok) throw new StorageError("UPLOAD_FAILED", `Cloudinary upload failed with HTTP ${response.status}`);
    const body = (await response.json()) as { secure_url?: string };
    return { publicUrl: input.visibility === "PUBLIC" ? (body.secure_url ?? null) : null };
  }

  async get(key: string, visibility: AttachmentVisibility): Promise<Uint8Array> {
    // The extension is not part of the key, so try the known ones in order of likelihood.
    for (const contentType of ["application/pdf", "image/jpeg", "image/png", "image/webp"]) {
      const publicId = this.publicId(key, contentType);
      const url =
        visibility === "PUBLIC"
          ? `https://res.cloudinary.com/${this.config.cloudName}/raw/upload/${publicId}`
          : `https://res.cloudinary.com/${this.config.cloudName}/raw/authenticated/s--${signCloudinaryDeliveryPath(publicId, this.config.apiSecret)}--/${publicId}`;
      const response = await this.fetchImpl(url);
      if (response.status === 404) continue;
      if (!response.ok) throw new StorageError("DOWNLOAD_FAILED", `Cloudinary download failed with HTTP ${response.status}`);
      return new Uint8Array(await response.arrayBuffer());
    }
    throw new StorageError("NOT_FOUND", "File not found in storage");
  }
}
