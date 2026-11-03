import { suggestNextChildCode, type CodedAccount } from "./account-code.js";

const acc = (id: string, code: string, parentId: string | null): CodedAccount => ({ id, code, parentId });

describe("suggestNextChildCode", () => {
  const root = acc("r", "1", null);
  const group = acc("g", "11", "r"); // level 2
  const sub = acc("s", "11108", "g"); // level 3

  it("starts a level-2 group at 101 and a level-3 group at 01", () => {
    expect(suggestNextChildCode([root, group], "g")).toBe("11101");
    expect(suggestNextChildCode([root, group, sub], "s")).toBe("1110801");
  });

  it("starts under a root with one digit", () => {
    expect(suggestNextChildCode([root], "r")).toBe("11");
  });

  it("goes after the highest sibling and never fills a gap", () => {
    const list = [root, group, sub, acc("a", "1110801", "s"), acc("b", "1110803", "s")];
    expect(suggestNextChildCode(list, "s")).toBe("1110804");
  });

  it("ignores lettered codes and codes of another width", () => {
    const list = [root, group, sub, acc("a", "1110801", "s"), acc("x", "1110805A0001", "s"), acc("y", "111080199", "s")];
    expect(suggestNextChildCode(list, "s")).toBe("1110802");
  });

  it("returns null when the numbering has run out or the parent is unknown", () => {
    const full = [root, group, sub, acc("last", "1110899", "s")];
    expect(suggestNextChildCode(full, "s")).toBeNull();
    expect(suggestNextChildCode([root], "missing")).toBeNull();
  });

  it("skips a code that exists elsewhere in the chart", () => {
    const list = [root, group, sub, acc("other", "1110801", null)];
    expect(suggestNextChildCode(list, "s")).toBe("1110802");
  });
});
