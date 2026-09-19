import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { CreateAccountDto } from "./create-account.dto.js";
import { UpdateAccountDto } from "./update-account.dto.js";

// Same options as the global ValidationPipe (docs/07-API-RULES.md §4): unknown fields are errors.
async function fieldsWithErrors<T extends object>(cls: new () => T, plain: object): Promise<string[]> {
  const errors = await validate(plainToInstance(cls, plain), { whitelist: true, forbidNonWhitelisted: true });
  return errors.map((e) => e.property).sort();
}

const validCreate = { code: "1110101001", name: "Custody", type: "ASSET", isPostable: true };

describe("CreateAccountDto", () => {
  it("accepts a lettered code, a party and a palette colour", async () => {
    expect(
      await fieldsWithErrors(CreateAccountDto, { ...validCreate, code: "2110601A0001", partyId: "p1", color: "#3B82F6" }),
    ).toEqual([]);
  });

  it("rejects a colour outside the palette and unknown fields", async () => {
    expect(await fieldsWithErrors(CreateAccountDto, { ...validCreate, color: "#123456" })).toEqual(["color"]);
    expect(await fieldsWithErrors(CreateAccountDto, { ...validCreate, color: "red" })).toEqual(["color"]);
    expect(await fieldsWithErrors(CreateAccountDto, { ...validCreate, normalBalance: "DEBIT" })).toEqual(["normalBalance"]);
  });
});

describe("UpdateAccountDto", () => {
  it("lets null clear the Arabic name, the party link and the colour", async () => {
    expect(await fieldsWithErrors(UpdateAccountDto, { nameAr: null, partyId: null, color: null })).toEqual([]);
  });

  it("cannot change the code, type, parent or postable flag", async () => {
    for (const field of ["code", "type", "parentId", "isPostable"]) {
      expect(await fieldsWithErrors(UpdateAccountDto, { [field]: "x" })).toEqual([field]);
    }
  });

  it("rejects an empty name and an off-palette colour", async () => {
    expect(await fieldsWithErrors(UpdateAccountDto, { name: "" })).toEqual(["name"]);
    expect(await fieldsWithErrors(UpdateAccountDto, { color: "#123456" })).toEqual(["color"]);
  });
});
