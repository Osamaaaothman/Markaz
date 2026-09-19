import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { CreatePartyDto } from "./create-party.dto.js";
import { PartiesQueryDto } from "./parties-query.dto.js";
import { UpdatePartyDto } from "./update-party.dto.js";

async function fieldsWithErrors<T extends object>(cls: new () => T, plain: object): Promise<string[]> {
  const errors = await validate(plainToInstance(cls, plain), { whitelist: true, forbidNonWhitelisted: true });
  return errors.map((e) => e.property).sort();
}

describe("party DTOs", () => {
  it("accepts a person with an Arabic name, phone and email", async () => {
    expect(
      await fieldsWithErrors(CreatePartyDto, { name: "Ammar", nameAr: "عمار", kind: "EMPLOYEE", phone: "0500000000", email: "a@b.co" }),
    ).toEqual([]);
  });

  it("rejects an unknown kind, an empty name and a bad email", async () => {
    expect(await fieldsWithErrors(CreatePartyDto, { name: "X", kind: "ROBOT" })).toEqual(["kind"]);
    expect(await fieldsWithErrors(CreatePartyDto, { name: "", kind: "PERSON" })).toEqual(["name"]);
    expect(await fieldsWithErrors(CreatePartyDto, { name: "X", kind: "PERSON", email: "nope" })).toEqual(["email"]);
  });

  it("lets an update clear optional details with null but not blank the name", async () => {
    expect(await fieldsWithErrors(UpdatePartyDto, { nameAr: null, phone: null, email: null, isActive: false })).toEqual([]);
    expect(await fieldsWithErrors(UpdatePartyDto, { name: "" })).toEqual(["name"]);
  });

  it("whitelists the list filters", async () => {
    expect(await fieldsWithErrors(PartiesQueryDto, { q: "amm", kind: "PERSON", limit: "20", includeInactive: "true" })).toEqual([]);
    expect(await fieldsWithErrors(PartiesQueryDto, { kind: "ROBOT" })).toEqual(["kind"]);
    expect(await fieldsWithErrors(PartiesQueryDto, { companyId: "other" })).toEqual(["companyId"]);
  });
});
