import { localizedCompanyName } from "./company-name.js";

describe("localizedCompanyName", () => {
  const company = { name: "Al Ufuq Contracting", nameAr: "الأفق للمقاولات" };

  it("prints the Arabic name in an Arabic document and the registered name otherwise", () => {
    expect(localizedCompanyName(company, "ar")).toBe("الأفق للمقاولات");
    expect(localizedCompanyName(company, "en")).toBe("Al Ufuq Contracting");
  });

  it("falls back to the registered name when there is no Arabic name, or it is blank", () => {
    expect(localizedCompanyName({ name: "Default Company", nameAr: null }, "ar")).toBe("Default Company");
    expect(localizedCompanyName({ name: "Default Company", nameAr: "   " }, "ar")).toBe("Default Company");
    expect(localizedCompanyName({ name: "Default Company" }, "ar")).toBe("Default Company");
  });
});
