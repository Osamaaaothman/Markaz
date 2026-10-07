import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { CloudinaryFileStorage, signCloudinaryDeliveryPath, signCloudinaryParams } from "./cloudinary-file-storage.js";
import { LocalFileStorage } from "./local-file-storage.js";
import { StorageError } from "./file-storage.js";

const file = "0192f3a4-7b2c-7c3e-9d41-5a6b7c8d9e10";
const key = `10/${file}`;
const pdf = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 1, 2, 3, 4]);

describe("LocalFileStorage", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "markaz-att-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("stores and reads back exactly the bytes it was given", async () => {
    const storage = new LocalFileStorage(dir);
    const stored = await storage.put({ key: key, bytes: pdf, contentType: "application/pdf", visibility: "PRIVATE" });
    expect(stored.publicUrl).toBeNull();
    expect(Array.from(await storage.get(key))).toEqual(Array.from(pdf));
  });

  it("refuses to overwrite an existing file", async () => {
    const storage = new LocalFileStorage(dir);
    const input = { key: key, bytes: pdf, contentType: "application/pdf" as const, visibility: "PRIVATE" as const };
    await storage.put(input);
    await expect(storage.put(input)).rejects.toThrow();
  });

  it("rejects keys that try to leave the folder, before touching the disk", async () => {
    const storage = new LocalFileStorage(dir);
    for (const bad of ["../outside", `10/../../outside`, "/etc/passwd", `10/${file}.pdf`, "default-company/x", ""]) {
      await expect(storage.get(bad)).rejects.toMatchObject({ code: "INVALID_KEY" });
      await expect(storage.put({ key: bad, bytes: pdf, contentType: "application/pdf", visibility: "PRIVATE" })).rejects.toBeInstanceOf(StorageError);
    }
    expect(await readdir(dir)).toEqual([]);
  });

  it("reports a missing file as NOT_FOUND", async () => {
    await expect(new LocalFileStorage(dir).get(key)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("Cloudinary signing", () => {
  it("signs sorted name=value pairs joined with & plus the secret, as SHA-1 hex", () => {
    const expected = createHash("sha1").update("public_id=a/b.pdf&timestamp=1700000000&type=authenticated" + "secret").digest("hex");
    expect(signCloudinaryParams({ type: "authenticated", timestamp: 1700000000, public_id: "a/b.pdf" }, "secret")).toBe(expected);
  });

  it("produces an 8 character URL-safe delivery signature", () => {
    const signature = signCloudinaryDeliveryPath("markaz/a/b.pdf", "secret");
    expect(signature).toMatch(/^[A-Za-z0-9_-]{8}$/);
    expect(signCloudinaryDeliveryPath("markaz/a/b.pdf", "other")).not.toBe(signature);
  });
});

describe("CloudinaryFileStorage (fake network)", () => {
  const config = { cloudName: "demo", apiKey: "key123", apiSecret: "secret456", folder: "markaz" };

  it("uploads private files as authenticated raw assets with a signature and never exposes a URL", async () => {
    const calls: { url: string; form: FormData }[] = [];
    const fetchImpl = ((url: string, init: { body: FormData }) => {
      calls.push({ url, form: init.body });
      return Promise.resolve(new Response(JSON.stringify({ secure_url: "https://res.cloudinary.com/demo/raw/authenticated/x" }), { status: 200 }));
    }) as unknown as typeof fetch;
    const storage = new CloudinaryFileStorage({ ...config, fetchImpl });

    const result = await storage.put({ key: key, bytes: pdf, contentType: "application/pdf", visibility: "PRIVATE" });

    expect(result.publicUrl).toBeNull();
    expect(calls[0]?.url).toBe("https://api.cloudinary.com/v1_1/demo/raw/upload");
    const form = calls[0]?.form as FormData;
    expect(form.get("type")).toBe("authenticated");
    expect(form.get("public_id")).toBe(`markaz/${key}.pdf`);
    expect(form.get("api_key")).toBe("key123");
    expect(form.get("api_secret")).toBeNull();
    const expected = signCloudinaryParams({ public_id: `markaz/${key}.pdf`, timestamp: Number(form.get("timestamp")), type: "authenticated" }, "secret456");
    expect(form.get("signature")).toBe(expected);
  });

  it("returns the permanent URL only for public files", async () => {
    const fetchImpl = (() => Promise.resolve(new Response(JSON.stringify({ secure_url: "https://res.cloudinary.com/demo/raw/upload/p.png" }), { status: 200 }))) as unknown as typeof fetch;
    const storage = new CloudinaryFileStorage({ ...config, fetchImpl });
    const result = await storage.put({ key: key, bytes: pdf, contentType: "image/png", visibility: "PUBLIC" });
    expect(result.publicUrl).toBe("https://res.cloudinary.com/demo/raw/upload/p.png");
  });

  it("turns an upload error into a StorageError", async () => {
    const fetchImpl = (() => Promise.resolve(new Response("nope", { status: 401 }))) as unknown as typeof fetch;
    const storage = new CloudinaryFileStorage({ ...config, fetchImpl });
    await expect(storage.put({ key: key, bytes: pdf, contentType: "application/pdf", visibility: "PRIVATE" })).rejects.toMatchObject({ code: "UPLOAD_FAILED" });
  });

  it("downloads private files through a signed delivery URL and tries other extensions on 404", async () => {
    const urls: string[] = [];
    const fetchImpl = ((url: string) => {
      urls.push(url);
      return Promise.resolve(url.endsWith(".jpg") ? new Response(pdf, { status: 200 }) : new Response("", { status: 404 }));
    }) as unknown as typeof fetch;
    const storage = new CloudinaryFileStorage({ ...config, fetchImpl });

    const bytes = await storage.get(key, "PRIVATE");

    expect(Array.from(bytes)).toEqual(Array.from(pdf));
    expect(urls[0]).toMatch(/^https:\/\/res\.cloudinary\.com\/demo\/raw\/authenticated\/s--[A-Za-z0-9_-]{8}--\/markaz\/.+\.pdf$/);
    expect(urls).toHaveLength(2);
    expect(urls.every((u) => !u.includes("secret456"))).toBe(true);
  });

  it("reports NOT_FOUND when no extension matches", async () => {
    const fetchImpl = (() => Promise.resolve(new Response("", { status: 404 }))) as unknown as typeof fetch;
    const storage = new CloudinaryFileStorage({ ...config, fetchImpl });
    await expect(storage.get(key, "PRIVATE")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
