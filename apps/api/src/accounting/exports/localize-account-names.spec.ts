import { collectAccountIds, withAccountNames } from "./localize-account-names.js";

const balanceSheetLike = {
  assets: { lines: [{ accountId: "a1", accountCode: "1110101", accountName: "Petty Cash", balance: "10.0000" }], total: "10.0000" },
  equity: {
    lines: [
      { accountId: "e1", accountCode: "3310101", accountName: "Retained Earnings", balance: "5.0000" },
      { accountId: "", accountCode: "", accountName: "Current year earnings", balance: "1.0000" },
    ],
  },
  isBalanced: true,
};

describe("localize-account-names", () => {
  it("collects account ids from any nested report shape", () => {
    expect([...collectAccountIds(balanceSheetLike)].sort()).toEqual(["", "a1", "e1"]);
  });

  it("swaps in the Arabic name only where one exists and leaves everything else untouched", () => {
    const localized = withAccountNames(balanceSheetLike, new Map([["a1", "العهد النقدية"]]));

    expect(localized.assets.lines[0]?.accountName).toBe("العهد النقدية");
    expect(localized.equity.lines[0]?.accountName).toBe("Retained Earnings");
    expect(localized.assets.lines[0]?.balance).toBe("10.0000");
    expect(localized.isBalanced).toBe(true);
  });

  it("does not mutate the original result", () => {
    withAccountNames(balanceSheetLike, new Map([["a1", "x"]]));
    expect(balanceSheetLike.assets.lines[0]?.accountName).toBe("Petty Cash");
  });
});
