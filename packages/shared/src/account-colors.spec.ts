import { ACCOUNT_COLORS, isAccountColor } from "./account-colors.js";

describe("account colours", () => {
  it("are all #RRGGBB, matching the accounts.color CHECK constraint", () => {
    for (const colour of ACCOUNT_COLORS) expect(colour).toMatch(/^#[0-9A-F]{6}$/);
  });

  it("accepts a palette colour in either case and rejects anything else", () => {
    expect(isAccountColor("#3b82f6")).toBe(true);
    expect(isAccountColor("#3B82F6")).toBe(true);
    expect(isAccountColor("#123456")).toBe(false);
    expect(isAccountColor("red")).toBe(false);
  });
});
