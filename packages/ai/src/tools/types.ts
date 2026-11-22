import type { z } from "zod";

// The three chat modes (docs/Planning/ai-assistant-plan.md §2.2).
//  ask    — read tools only. Write tools are never even shown to the model.
//  review — read + write; every write becomes a proposal the user must approve.
//  auto   — read + write; low-risk writes run at once, high-risk ones still need approval.
export type AssistantMode = "ask" | "review" | "auto";

export type ToolKind = "read" | "write";

// low  — creates drafts or master data that the user can still edit or deactivate.
// high — posts to the ledger, moves money, sends something out, or cannot be undone.
//        Always needs an explicit approval, in every mode.
export type ToolRisk = "low" | "high";

export type Locale = "ar" | "en";

export interface ToolActor {
  readonly userId: string;
  readonly companyId: string;
}

export interface ToolContext {
  readonly actor: ToolActor;
  readonly locale: Locale;
  readonly conversationId: string;
  readonly correlationId: string;
  can(resource: string, action: string): Promise<boolean>;
}

// What the user sees on a proposal card before anything is written.
export interface ChangePreview {
  readonly titleKey: string;
  readonly entity: string;
  readonly fields: ReadonlyArray<{ readonly labelKey: string; readonly value: string; readonly before?: string }>;
  readonly warningKeys?: ReadonlyArray<string>;
}

// Structured blocks the UI renders under an answer. The model never writes HTML; a read tool
// returns one of these next to the data it gives the model.
export type DisplayBlock =
  | { readonly kind: "kpis"; readonly titleKey: string; readonly items: ReadonlyArray<{ readonly labelKey: string; readonly value: string; readonly format: "money" | "number" | "text"; readonly currency?: string }> }
  | { readonly kind: "table"; readonly titleKey: string; readonly columns: ReadonlyArray<{ readonly key: string; readonly labelKey: string; readonly format?: "money" | "number" | "text" | "date" }>; readonly rows: ReadonlyArray<Readonly<Record<string, string>>>; readonly link?: string }
  | { readonly kind: "chart"; readonly titleKey: string; readonly chartType: "bar" | "line"; readonly labels: ReadonlyArray<string>; readonly series: ReadonlyArray<{ readonly labelKey: string; readonly values: ReadonlyArray<number> }> }
  | { readonly kind: "links"; readonly titleKey: string; readonly items: ReadonlyArray<{ readonly label: string; readonly path: string; readonly hint?: string }> };

export interface ReadResult {
  // Given to the model (wrapped as untrusted data). Keep it small: only fields the answer needs.
  readonly data: unknown;
  readonly display?: DisplayBlock;
}

// What a write returns after it ran.
export interface WriteResult {
  readonly data: Readonly<Record<string, unknown>>;
  // A record the user can open, e.g. { label: "EMP-0042", path: "/hr/employees/..." }.
  readonly link?: { readonly label: string; readonly path: string };
}

interface ToolBase<S extends z.ZodType> {
  readonly name: string;
  // English, written for the model: this text is the tool's real interface.
  readonly description: string;
  readonly input: S;
  readonly permission: { readonly resource: string; readonly action: string };
}

export interface ReadTool<S extends z.ZodType = z.ZodType> extends ToolBase<S> {
  readonly kind: "read";
  run(ctx: ToolContext, input: z.infer<S>): Promise<ReadResult>;
}

export interface WriteTool<S extends z.ZodType = z.ZodType> extends ToolBase<S> {
  readonly kind: "write";
  readonly risk: ToolRisk;
  // Must not write anything. May read (e.g. to check a name is free).
  preview(ctx: ToolContext, input: z.infer<S>): Promise<ChangePreview>;
  execute(ctx: ToolContext, input: z.infer<S>): Promise<WriteResult>;
}

export type ErpTool = ReadTool | WriteTool;

export function defineReadTool<S extends z.ZodType>(tool: Omit<ReadTool<S>, "kind">): ReadTool {
  return { ...tool, kind: "read" } as unknown as ReadTool;
}

export function defineWriteTool<S extends z.ZodType>(tool: Omit<WriteTool<S>, "kind">): WriteTool {
  return { ...tool, kind: "write" } as unknown as WriteTool;
}
