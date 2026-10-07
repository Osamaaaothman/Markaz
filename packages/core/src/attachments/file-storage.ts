import type { AttachmentContentType, AttachmentVisibility } from "./attachment-rules.js";

export type StorageProvider = "LOCAL" | "CLOUDINARY";

export interface PutFileInput {
  // Random, server-generated (STORAGE_KEY_PATTERN). Never derived from a file name.
  readonly key: string;
  readonly bytes: Uint8Array;
  readonly contentType: AttachmentContentType;
  readonly visibility: AttachmentVisibility;
}

export interface StoredFile {
  // Set only when the provider can serve the file to anyone with the link (public item pictures).
  readonly publicUrl: string | null;
}

// Where the bytes live. The database keeps only metadata and the key. Two implementations exist on purpose:
// a folder on the deployment's own data volume, and Cloudinary. Files are small (capped at upload), so they
// travel as whole buffers.
export interface IFileStorage {
  readonly provider: StorageProvider;
  put(input: PutFileInput): Promise<StoredFile>;
  get(key: string, visibility: AttachmentVisibility): Promise<Uint8Array>;
}

export class StorageError extends Error {
  constructor(
    readonly code: "NOT_FOUND" | "UPLOAD_FAILED" | "DOWNLOAD_FAILED" | "INVALID_KEY",
    message: string,
  ) {
    super(message);
  }
}
