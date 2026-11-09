import { FIRST_INVOICE_PREVIOUS_HASH } from "./egs-chain.service.js";

describe("FIRST_INVOICE_PREVIOUS_HASH", () => {
  // Golden value from the official ZATCA SDK's own fixture, verified 2026-11-04:
  // docs/vendor/zatca/sdk (zatca-einvoicing-sdk-238-R3.4.8) Data/PIH/pih.txt. Pinned literally
  // so a future refactor of the derivation can never silently drift from the SDK's own value —
  // the whole invoice hash chain is worthless if this one constant is wrong.
  it("matches the official SDK's Data/PIH/pih.txt exactly", () => {
    expect(FIRST_INVOICE_PREVIOUS_HASH).toBe("NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==");
  });

  it("decodes to the hex string of SHA-256(\"0\"), not the raw digest bytes", () => {
    expect(Buffer.from(FIRST_INVOICE_PREVIOUS_HASH, "base64").toString("utf8")).toBe("5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9");
  });
});
