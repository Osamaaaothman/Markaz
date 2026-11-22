import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { shrinkOldToolResults } from "./history.js";

describe("shrinkOldToolResults", () => {
  it("shortens earlier turns' tool data and leaves the current turn whole", () => {
    const big = "x".repeat(5000);
    const out = shrinkOldToolResults([
      new HumanMessage("first"),
      new AIMessage({ content: "", tool_calls: [{ id: "a", name: "t", args: {} }] }),
      new ToolMessage({ content: big, tool_call_id: "a", name: "t" }),
      new AIMessage("answer"),
      new HumanMessage("second"),
      new AIMessage({ content: "", tool_calls: [{ id: "b", name: "t", args: {} }] }),
      new ToolMessage({ content: big, tool_call_id: "b", name: "t" }),
    ]);
    const old = out[2] as ToolMessage;
    expect(String(old.content).length).toBeLessThan(800);
    expect(old.tool_call_id).toBe("a");
    expect(String(old.content)).toContain("call the tool again");
    expect(String((out[6] as ToolMessage).content)).toHaveLength(5000);
  });
});
