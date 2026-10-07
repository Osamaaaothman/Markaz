import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { STORAGE_KEY_PATTERN } from "./attachment-rules.js";
import { StorageError, type IFileStorage, type PutFileInput, type StoredFile } from "./file-storage.js";

// Files in a folder on this deployment's own data volume (docker volume `attachments_data`). The folder holds
// customer documents: it must be backed up with the database (docs/12-OPS-AND-DEPLOYMENT.md section 6).
export class LocalFileStorage implements IFileStorage {
  readonly provider = "LOCAL" as const;
  private readonly root: string;

  constructor(rootDir: string) {
    this.root = resolve(rootDir);
  }

  // The key pattern already excludes "..", separators other than the one company/file slash, and absolute
  // paths; the prefix check is a second wall in case the pattern is ever loosened.
  private pathFor(key: string): string {
    if (!STORAGE_KEY_PATTERN.test(key)) throw new StorageError("INVALID_KEY", "Invalid storage key");
    const full = resolve(join(this.root, key));
    if (!full.startsWith(this.root + sep)) throw new StorageError("INVALID_KEY", "Invalid storage key");
    return full;
  }

  async put(input: PutFileInput): Promise<StoredFile> {
    const target = this.pathFor(input.key);
    await mkdir(dirname(target), { recursive: true });
    // "wx": never overwrite an existing file, even on a key collision.
    await writeFile(target, input.bytes, { flag: "wx" });
    return { publicUrl: null };
  }

  async get(key: string): Promise<Uint8Array> {
    const target = this.pathFor(key);
    try {
      return await readFile(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new StorageError("NOT_FOUND", "File not found in storage");
      throw error;
    }
  }
}
