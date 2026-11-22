import type { ChangePreview, DisplayBlock, ToolRisk, WriteResult } from "../tools/types.js";

// One proposed change waiting for the user (a card in the UI). `id` is "c1", "c2", ... and is what
// later proposals use in "$ref:c1.id".
export interface ProposedItem {
  readonly id: string;
  readonly toolCallId: string;
  readonly tool: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly preview: ChangePreview;
  readonly risk: ToolRisk;
  readonly dependsOn: readonly string[];
}

export interface ExecutedItem {
  readonly id: string;
  readonly tool: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly result: WriteResult;
  readonly auto: boolean;
}

// Everything the server streams to the browser while the assistant works.
export type AssistantEvent =
  | { readonly type: "token"; readonly text: string }
  | { readonly type: "tool_start"; readonly callId: string; readonly tool: string }
  | { readonly type: "tool_end"; readonly callId: string; readonly tool: string; readonly ok: boolean; readonly ms: number; readonly errorCode?: string }
  | { readonly type: "display"; readonly block: DisplayBlock }
  | { readonly type: "proposed"; readonly item: ProposedItem }
  | { readonly type: "executed"; readonly item: ExecutedItem }
  | { readonly type: "clarify"; readonly question: string; readonly options: readonly string[] }
  | { readonly type: "step_limit" };

export interface TokenUsage {
  readonly input: number;
  readonly output: number;
}
