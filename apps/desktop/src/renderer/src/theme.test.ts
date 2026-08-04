import { describe, expect, it } from "vitest";
import { theme } from "./theme";

describe("theme", () => {
  it("uses the brand color as the primary color", () => {
    expect(theme.primaryColor).toBe("brand");
  });

  it("defines a full 10-shade brand palette (required by Mantine)", () => {
    expect(theme.colors?.brand).toHaveLength(10);
  });
});
