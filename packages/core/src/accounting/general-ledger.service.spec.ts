import { foldLedgerLines, type RawLedgerLine } from "./general-ledger.service.js";

function line(debit: string, credit: string): RawLedgerLine {
  return { entryId: "e", entryNumber: "JE-1", entryDate: "2026-01-01", description: null, debit, credit };
}

describe("foldLedgerLines", () => {
  it("runs a debit-normal account as debit minus credit", () => {
    const result = foldLedgerLines("DEBIT", "100.0000", "0.0000", [line("50.0000", "0.0000"), line("0.0000", "30.2500")]);
    expect(result.openingBalance).toBe("100.0000");
    expect(result.lines.map((l) => l.balance)).toEqual(["150.0000", "119.7500"]);
    expect(result.closingBalance).toBe("119.7500");
  });

  it("runs a credit-normal account as credit minus debit", () => {
    const result = foldLedgerLines("CREDIT", "0.0000", "500.0000", [line("0.0000", "100.0000"), line("700.0000", "0.0000")]);
    expect(result.openingBalance).toBe("500.0000");
    expect(result.lines.map((l) => l.balance)).toEqual(["600.0000", "-100.0000"]);
  });

  it("returns the opening balance as the closing balance when nothing posted", () => {
    const result = foldLedgerLines("DEBIT", "10.0000", "4.0000", []);
    expect(result.closingBalance).toBe("6.0000");
    expect(result.lines).toEqual([]);
  });

  it("stays exact where floats would drift", () => {
    const lines = Array.from({ length: 10 }, () => line("0.1000", "0.0000"));
    expect(foldLedgerLines("DEBIT", "0.0000", "0.0000", lines).closingBalance).toBe("1.0000");
  });
});
