import { domainErrorFields } from "./domain-error.js";

describe("domainErrorFields", () => {
  it("returns the code and line number a controller put in the body", () => {
    expect(domainErrorFields({ message: "x", code: "QTY_EXCEEDS_RECEIVED", lineNumber: 2 })).toEqual({ code: "QTY_EXCEEDS_RECEIVED", lineNumber: 2 });
  });

  it("returns nothing for a plain string or framework body, and ignores wrongly typed fields", () => {
    expect(domainErrorFields("Not Found")).toEqual({});
    expect(domainErrorFields(null)).toEqual({});
    expect(domainErrorFields({ statusCode: 404, message: "Nope" })).toEqual({});
    expect(domainErrorFields({ code: 5, lineNumber: "2" })).toEqual({});
  });
});
