import { BaseChatModel, type BindToolsInput } from "@langchain/core/language_models/chat_models";
import type { BaseMessage } from "@langchain/core/messages";
import { AIMessage } from "@langchain/core/messages";
import type { ChatResult } from "@langchain/core/outputs";

// A fake LLM for tests: returns the scripted replies in order and records what it was sent.
// No network, fully deterministic — CI never calls a real provider.
export interface ScriptedReply {
  readonly text?: string;
  readonly toolCalls?: ReadonlyArray<{ readonly name: string; readonly args: Record<string, unknown> }>;
}

export class ScriptedChatModel extends BaseChatModel {
  readonly seen: BaseMessage[][] = [];
  boundToolNames: string[] = [];
  private index = 0;

  constructor(private readonly replies: readonly ScriptedReply[]) {
    super({});
  }

  _llmType(): string {
    return "scripted";
  }

  override bindTools(tools: BindToolsInput[]): this {
    this.boundToolNames = tools.map((t) => (t !== null && typeof t === "object" && "name" in t && typeof t.name === "string" ? t.name : ""));
    return this;
  }

  _generate(messages: BaseMessage[]): Promise<ChatResult> {
    this.seen.push(messages);
    const reply = this.replies[this.index++] ?? { text: "(no more scripted replies)" };
    const message = new AIMessage({
      content: reply.text ?? "",
      tool_calls: (reply.toolCalls ?? []).map((c, i) => ({ id: `call_${this.index}_${i}`, name: c.name, args: c.args, type: "tool_call" as const })),
    });
    // usage_metadata is typed per provider in LangChain 1.x; set it structurally like a real provider does.
    Object.assign(message, { usage_metadata: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } });
    return Promise.resolve({ generations: [{ message, text: reply.text ?? "" }] });
  }
}
