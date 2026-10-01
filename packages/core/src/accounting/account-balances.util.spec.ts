import { rollUpBalances, type AccountNode, type OwnTotals } from "./account-balances.util.js";

// 1 (root) > 11 > 11101 (leaf, cash) ; 11 > 11102 (leaf, bank) ; 2 (root) > 21 (leaf)
const tree: AccountNode[] = [
  { id: "1", parentId: null },
  { id: "11", parentId: "1" },
  { id: "11101", parentId: "11" },
  { id: "11102", parentId: "11" },
  { id: "2", parentId: null },
  { id: "21", parentId: "2" },
];

function own(entries: Record<string, [string, string]>): Map<string, OwnTotals> {
  return new Map(Object.entries(entries).map(([id, [debit, credit]]) => [id, { debit, credit }]));
}

function byId(result: ReturnType<typeof rollUpBalances>): Record<string, ReturnType<typeof rollUpBalances>[number]> {
  return Object.fromEntries(result.map((r) => [r.accountId, r]));
}

describe("rollUpBalances", () => {
  it("shows a leaf's own totals and every ancestor as the sum of its children", () => {
    const result = byId(
      rollUpBalances(tree, own({ "11101": ["1000.0000", "0"], "11102": ["250.5000", "50.2500"] })),
    );

    expect(result["11101"]).toMatchObject({ debitTotal: "1000.0000", creditTotal: "0.0000", balance: "1000.0000", balanceSide: "DEBIT" });
    expect(result["11102"]).toMatchObject({ debitTotal: "250.5000", creditTotal: "50.2500", balance: "200.2500", balanceSide: "DEBIT" });
    expect(result["11"]).toMatchObject({ debitTotal: "1250.5000", creditTotal: "50.2500", balance: "1200.2500" });
    expect(result["1"]).toMatchObject({ debitTotal: "1250.5000", creditTotal: "50.2500", balance: "1200.2500" });
  });

  it("leaves branches with no postings at zero with no side", () => {
    const result = byId(rollUpBalances(tree, own({ "11101": ["10", "0"] })));

    expect(result["2"]).toMatchObject({ debitTotal: "0.0000", creditTotal: "0.0000", balance: "0.0000", balanceSide: null });
    expect(result["21"]!.balanceSide).toBeNull();
  });

  it("reports the credit side when credits exceed debits", () => {
    const result = byId(rollUpBalances(tree, own({ "21": ["0", "75.0000"] })));

    expect(result["21"]).toMatchObject({ balance: "75.0000", balanceSide: "CREDIT" });
    expect(result["2"]).toMatchObject({ debitTotal: "0.0000", creditTotal: "75.0000", balanceSide: "CREDIT" });
  });

  it("shows a null side when debits and credits cancel out but keeps both totals", () => {
    const result = byId(rollUpBalances(tree, own({ "11101": ["100.0000", "100.0000"] })));

    expect(result["11101"]).toMatchObject({ debitTotal: "100.0000", creditTotal: "100.0000", balance: "0.0000", balanceSide: null });
  });

  it("adds an account's own postings to its children's (legacy parent with its own lines)", () => {
    const result = byId(rollUpBalances(tree, own({ "11": ["5.0000", "0"], "11101": ["10.0000", "0"] })));

    expect(result["11"]).toMatchObject({ debitTotal: "15.0000" });
    expect(result["1"]).toMatchObject({ debitTotal: "15.0000" });
  });

  it("stays exact where floating point would drift", () => {
    const result = byId(
      rollUpBalances(tree, own({ "11101": ["0.1000", "0"], "11102": ["0.2000", "0"] })),
    );

    expect(result["11"]!.debitTotal).toBe("0.3000");
  });

  it("treats an account whose parent is missing as a root", () => {
    const result = byId(
      rollUpBalances([{ id: "x", parentId: "not-in-list" }, ...tree], own({ x: ["7", "0"] })),
    );

    expect(result["x"]).toMatchObject({ debitTotal: "7.0000" });
    expect(result["1"]).toMatchObject({ debitTotal: "0.0000" });
  });

  it("does not loop forever on a parent cycle", () => {
    const cyclic: AccountNode[] = [
      { id: "a", parentId: "b" },
      { id: "b", parentId: "a" },
    ];

    expect(() => rollUpBalances(cyclic, own({ a: ["1", "0"], b: ["2", "0"] }))).not.toThrow();
  });

  it("returns one entry per account in the given order", () => {
    expect(rollUpBalances(tree, own({})).map((r) => r.accountId)).toEqual(["1", "11", "11101", "11102", "2", "21"]);
  });
});
