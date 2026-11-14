import { tafqeetAmount } from "./tafqeet.js";

describe("English currency amounts in words", () => {
  it.each([
    ["0", "SAR", "Zero Saudi riyals only"],
    ["1.01", "SAR", "One Saudi riyal and one halala only"],
    ["115", "SAR", "One hundred and fifteen Saudi riyals only"],
    ["21.75", "USD", "Twenty-one US dollars and seventy-five cents only"],
    ["2.02", "GBP", "Two pounds sterling and two pence only"],
    ["1.025", "KWD", "One Kuwaiti dinar and twenty-five fils only"],
    ["1.9995", "BHD", "Two Bahraini dinars only"],
    ["1.5", "JPY", "Two Japanese yen only"],
    ["-12.05", "EUR", "Minus twelve euros and five cents only"],
    ["999.995", "AED", "One thousand UAE dirhams only"],
    ["1.001", "OMR", "One Omani rial and one baisa only"],
    ["9007199254740991.99", "USD", "Nine quadrillion seven trillion one hundred and ninety-nine billion two hundred and fifty-four million seven hundred and forty thousand nine hundred and ninety-one US dollars and ninety-nine cents only"],
  ])("renders %s %s without losing precision", (amount, currency, expected) => {
    expect(tafqeetAmount(amount, currency, "en-GB")).toBe(expected);
  });
  it("preserves Arabic as the default and never substitutes SAR for unknown currencies", () => {
    expect(tafqeetAmount("115", "SAR")).toBe("فقط مائة وخمسة عشر ريال لا غير");
    expect(tafqeetAmount("1.25", "XYZ", "en")).toBe("One XYZ and twenty-five minor units only");
  });
});
