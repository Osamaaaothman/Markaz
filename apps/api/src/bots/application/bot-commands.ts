import type { CommandSpec } from "@erp/bots";
import enBots from "../../i18n/locales/en/bots.json";
import arBots from "../../i18n/locales/ar/bots.json";

// The slash commands registered with every platform. Descriptions come from the same locale files
// as every other bot string (no hard-coded copy).
type CommandKey = keyof typeof enBots.commands;

function describe(key: CommandKey): { en: string; ar: string } {
  return { en: enBots.commands[key], ar: arBots.commands[key] };
}

function text(key: CommandKey, optionKey: CommandKey, required: boolean): CommandSpec {
  return { name: key, description: describe(key), option: { name: "query", kind: "text", description: describe(optionKey), required } };
}

export const BOT_COMMANDS: ReadonlyArray<CommandSpec> = [
  { name: "menu", description: describe("menu") },
  { name: "approvals", description: describe("approvals") },
  text("customer", "queryOption", false),
  text("item", "queryOption", false),
  text("invoice", "queryOption", false),
  { name: "cash", description: describe("cash") },
  { name: "report", description: describe("report") },
  { name: "attach", description: describe("attach"), option: { name: "file", kind: "file", description: describe("fileOption"), required: true } },
  { name: "link", description: describe("link"), option: { name: "code", kind: "text", description: describe("codeOption"), required: true } },
  { name: "unlink", description: describe("unlink") },
  { name: "settings", description: describe("settings") },
  { name: "chatid", description: describe("chatid") },
  { name: "help", description: describe("help") },
];
