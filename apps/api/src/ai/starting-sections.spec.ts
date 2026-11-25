import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { startingSections } from "./ai-chat.service.js";

// One user message that used a tool, with its tool reply.
function turn(text: string, tool: string): BaseMessage[] {
  return [
    new HumanMessage(text),
    new AIMessage({ content: "", tool_calls: [{ id: `id_${text}`, name: tool, args: {}, type: "tool_call" }] }),
    new ToolMessage({ content: "{}", tool_call_id: `id_${text}`, name: tool }),
    new AIMessage("ok"),
  ];
}

describe("startingSections", () => {
  it("keeps the sections used in the last three user messages", () => {
    const history = [...turn("a", "sales_createInvoice"), ...turn("b", "hr_createEmployee"), ...turn("c", "parties_search"), new HumanMessage("now")];
    expect(startingSections(history, undefined).sort()).toEqual(["hr"]);
  });

  it("drops a section the conversation stopped using", () => {
    const history = [...turn("a", "sales_createInvoice"), ...turn("b", "parties_search"), ...turn("c", "parties_search"), ...turn("d", "parties_search"), new HumanMessage("now")];
    expect(startingSections(history, undefined)).toEqual([]);
  });

  it("keeps a section loaded with load_tools in a recent message", () => {
    const history = [new HumanMessage("x"), new AIMessage({ content: "", tool_calls: [{ id: "l1", name: "load_tools", args: { section: "payments" }, type: "tool_call" }] }), new ToolMessage({ content: "{}", tool_call_id: "l1" }), new HumanMessage("now")];
    expect(startingSections(history, undefined)).toEqual(["payments"]);
  });

  it("keeps the section of a card still waiting, however old", () => {
    const history = [...turn("b", "parties_search"), ...turn("c", "parties_search"), ...turn("d", "parties_search"), new HumanMessage("now")];
    expect(startingSections(history, undefined, ["sales_createInvoice"])).toEqual(["sales"]);
  });
});
