import { tafqeetAmount } from "./tafqeet.js";

describe("tafqeetAmount", () => {
  describe("SAR — whole riyals", () => {
    it("0", () => expect(tafqeetAmount("0", "SAR")).toBe("فقط صفر ريال لا غير"));
    it("1", () => expect(tafqeetAmount("1", "SAR")).toBe("فقط ريال واحد لا غير"));
    it("2", () => expect(tafqeetAmount("2", "SAR")).toBe("فقط ريالان لا غير"));
    it("3", () => expect(tafqeetAmount("3", "SAR")).toBe("فقط ثلاثة ريالات لا غير"));
    it("10", () => expect(tafqeetAmount("10", "SAR")).toBe("فقط عشرة ريالات لا غير"));
    it("11", () => expect(tafqeetAmount("11", "SAR")).toBe("فقط أحد عشر ريال لا غير"));
    it("15", () => expect(tafqeetAmount("15", "SAR")).toBe("فقط خمسة عشر ريال لا غير"));
    it("20", () => expect(tafqeetAmount("20", "SAR")).toBe("فقط عشرون ريال لا غير"));
    it("21", () => expect(tafqeetAmount("21", "SAR")).toBe("فقط واحد وعشرون ريال لا غير"));
    it("25", () => expect(tafqeetAmount("25", "SAR")).toBe("فقط خمسة وعشرون ريال لا غير"));
    it("99", () => expect(tafqeetAmount("99", "SAR")).toBe("فقط تسعة وتسعون ريال لا غير"));
    it("100", () => expect(tafqeetAmount("100", "SAR")).toBe("فقط مائة ريال لا غير"));
    it("101", () => expect(tafqeetAmount("101", "SAR")).toBe("فقط مائة وواحد ريال لا غير"));
    it("125", () => expect(tafqeetAmount("125", "SAR")).toBe("فقط مائة وخمسة وعشرون ريال لا غير"));
    it("200", () => expect(tafqeetAmount("200", "SAR")).toBe("فقط مئتان ريال لا غير"));
    it("300", () => expect(tafqeetAmount("300", "SAR")).toBe("فقط ثلاثمائة ريال لا غير"));
    it("999", () => expect(tafqeetAmount("999", "SAR")).toBe("فقط تسعمائة وتسعة وتسعون ريال لا غير"));
    it("1000", () => expect(tafqeetAmount("1000", "SAR")).toBe("فقط ألف ريال لا غير"));
    it("2000", () => expect(tafqeetAmount("2000", "SAR")).toBe("فقط ألفان ريال لا غير"));
    it("3000", () => expect(tafqeetAmount("3000", "SAR")).toBe("فقط ثلاثة آلاف ريال لا غير"));
    it("15000", () => expect(tafqeetAmount("15000", "SAR")).toBe("فقط خمسة عشر ألف ريال لا غير"));
    it("100000", () => expect(tafqeetAmount("100000", "SAR")).toBe("فقط مائة ألف ريال لا غير"));
    it("1000000", () => expect(tafqeetAmount("1000000", "SAR")).toBe("فقط مليون ريال لا غير"));
    it("2000000", () => expect(tafqeetAmount("2000000", "SAR")).toBe("فقط مليونان ريال لا غير"));
    it("3500000", () => expect(tafqeetAmount("3500000", "SAR")).toBe("فقط ثلاثة ملايين وخمسمائة ألف ريال لا غير"));
    it("1234567", () =>
      expect(tafqeetAmount("1234567", "SAR")).toBe("فقط مليون ومئتان وأربعة وثلاثون ألف وخمسمائة وسبعة وستون ريال لا غير"));
  });

  describe("SAR — riyals and halalas together", () => {
    it("37.95 — halala is feminine, so 5 is spelled خمس not خمسة", () => expect(tafqeetAmount("37.95", "SAR")).toBe("فقط سبعة وثلاثون ريال وخمس وتسعون هللة لا غير"));
    it("115.00 — exact riyals drop the halala clause", () => expect(tafqeetAmount("115.00", "SAR")).toBe("فقط مائة وخمسة عشر ريال لا غير"));
    it("9775.00", () => expect(tafqeetAmount("9775", "SAR")).toBe("فقط تسعة آلاف وسبعمائة وخمسة وسبعون ريال لا غير"));
    it("0.50", () => expect(tafqeetAmount("0.50", "SAR")).toBe("فقط صفر ريال وخمسون هللة لا غير"));
    it("1.01", () => expect(tafqeetAmount("1.01", "SAR")).toBe("فقط ريال واحد وهللة واحدة لا غير"));
    it("2.02", () => expect(tafqeetAmount("2.02", "SAR")).toBe("فقط ريالان وهللتان لا غير"));
    it("rounds a third decimal place half-up before spelling", () => expect(tafqeetAmount("10.005", "SAR")).toBe("فقط عشرة ريالات وهللة واحدة لا غير"));
  });

  describe("other currencies", () => {
    it("KWD uses 3-decimal fils", () => expect(tafqeetAmount("1.500", "KWD")).toBe("فقط دينار كويتي واحد وخمسمائة فلس لا غير"));
    it("JPY has no minor unit", () => expect(tafqeetAmount("1000", "JPY")).toBe("فقط ألف ين ياباني لا غير"));
    it("an unknown currency code falls back to SAR wording rather than throwing", () => expect(() => tafqeetAmount("10", "XXX")).not.toThrow());
  });
});
