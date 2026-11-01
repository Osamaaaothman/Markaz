import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { parseAttachmentConfig } from "./attachments.config.js";
import { AttachmentContentQueryDto, AttachmentsQueryDto, UploadAttachmentDto } from "./dto/attachment-dtos.js";

async function fieldsWithErrors<T extends object>(cls: new () => T, plain: object): Promise<string[]> {
  const errors = await validate(plainToInstance(cls, plain), { whitelist: true, forbidNonWhitelisted: true });
  return errors.map((e) => e.property).sort();
}

const uuid = "0192f3a4-7b2c-7c3e-9d41-5a6b7c8d9e0f";

describe("attachment DTOs", () => {
  it("accepts a known record type with a record id", async () => {
    expect(await fieldsWithErrors(UploadAttachmentDto, { ownerType: "SALES_INVOICE", ownerId: uuid })).toEqual([]);
  });

  it("accepts the seeded company id, which is not a UUID", async () => {
    expect(await fieldsWithErrors(UploadAttachmentDto, { ownerType: "COMPANY", ownerId: "default-company" })).toEqual([]);
  });

  it("rejects an unknown record type, a missing id and an id with unsafe characters", async () => {
    expect(await fieldsWithErrors(UploadAttachmentDto, { ownerType: "WAREHOUSE", ownerId: uuid })).toEqual(["ownerType"]);
    expect(await fieldsWithErrors(UploadAttachmentDto, { ownerType: "PARTY" })).toEqual(["ownerId"]);
    expect(await fieldsWithErrors(UploadAttachmentDto, { ownerType: "PARTY", ownerId: "../../etc" })).toEqual(["ownerId"]);
    expect(await fieldsWithErrors(UploadAttachmentDto, { ownerType: "PARTY", ownerId: "a b" })).toEqual(["ownerId"]);
  });

  it("refuses a visibility or company id sent by the client", async () => {
    expect(await fieldsWithErrors(UploadAttachmentDto, { ownerType: "PARTY", ownerId: uuid, visibility: "PUBLIC" })).toEqual(["visibility"]);
    expect(await fieldsWithErrors(UploadAttachmentDto, { ownerType: "PARTY", ownerId: uuid, companyId: uuid })).toEqual(["companyId"]);
  });

  it("whitelists the list filters and the download flag", async () => {
    expect(await fieldsWithErrors(AttachmentsQueryDto, { ownerType: "PARTY", ownerId: uuid, q: "invoice", limit: "20" })).toEqual([]);
    expect(await fieldsWithErrors(AttachmentsQueryDto, { companyId: uuid })).toEqual(["companyId"]);
    expect(await fieldsWithErrors(AttachmentContentQueryDto, { download: "true" })).toEqual([]);
    expect(await fieldsWithErrors(AttachmentContentQueryDto, { download: "yes" })).toEqual(["download"]);
  });
});

describe("parseAttachmentConfig", () => {
  it("defaults to local storage with a 10 MB limit and needs no settings at all", () => {
    expect(parseAttachmentConfig({})).toEqual({ provider: "LOCAL", maxBytes: 10 * 1024 * 1024, localDir: "/data/attachments" });
  });

  it("reads the limit and folder, and never allows more than the hard ceiling", () => {
    expect(parseAttachmentConfig({ ATTACHMENT_MAX_BYTES: "2048", ATTACHMENT_LOCAL_DIR: "/tmp/x" })).toMatchObject({ maxBytes: 2048, localDir: "/tmp/x" });
    expect(parseAttachmentConfig({ ATTACHMENT_MAX_BYTES: "999999999999" }).maxBytes).toBe(50 * 1024 * 1024);
    expect(parseAttachmentConfig({ ATTACHMENT_MAX_BYTES: "abc" }).maxBytes).toBe(10 * 1024 * 1024);
  });

  it("selects Cloudinary only when all three credentials are present", () => {
    const config = parseAttachmentConfig({ ATTACHMENT_STORAGE: "cloudinary", CLOUDINARY_CLOUD_NAME: "demo", CLOUDINARY_API_KEY: "k", CLOUDINARY_API_SECRET: "s" });
    expect(config).toMatchObject({ provider: "CLOUDINARY", cloudName: "demo", folder: "markaz" });
  });

  it("fails at startup, naming what is missing, without printing any value", () => {
    expect(() => parseAttachmentConfig({ ATTACHMENT_STORAGE: "cloudinary", CLOUDINARY_CLOUD_NAME: "demo" })).toThrow(/CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET/);
    expect(() => parseAttachmentConfig({ ATTACHMENT_STORAGE: "s3" })).toThrow(/must be "local" or "cloudinary"/);
    try {
      parseAttachmentConfig({ ATTACHMENT_STORAGE: "cloudinary", CLOUDINARY_API_KEY: "key-value-1" });
    } catch (error) {
      expect(String(error)).not.toContain("key-value-1");
    }
  });
});
