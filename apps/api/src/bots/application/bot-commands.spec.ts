import { BOT_COMMANDS } from "./bot-commands.js";

describe("BOT_COMMANDS", () => {
  it("uses names valid on Telegram and Discord", () => {
    for (const command of BOT_COMMANDS) {
      expect(command.name).toMatch(/^[a-z][a-z0-9_]{0,31}$/);
    }
  });

  it("has unique names", () => {
    const names = BOT_COMMANDS.map((command) => command.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("describes every command in English (1-100 chars) and in Arabic", () => {
    for (const command of BOT_COMMANDS) {
      expect(command.description.en.length).toBeGreaterThanOrEqual(1);
      expect(command.description.en.length).toBeLessThanOrEqual(100);
      expect(command.description.ar.trim().length).toBeGreaterThan(0);
    }
  });

  it("asks for a file on attach and a required code on link", () => {
    const attach = BOT_COMMANDS.find((command) => command.name === "attach");
    const link = BOT_COMMANDS.find((command) => command.name === "link");

    expect(attach?.option?.kind).toBe("file");
    expect(link?.option?.required).toBe(true);
  });
});
