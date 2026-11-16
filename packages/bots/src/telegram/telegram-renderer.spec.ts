import type { BotMessage } from "../contract/ui-kit.js";
import { isolate } from "../render/common.js";
import { TELEGRAM_TEXT_LIMIT, renderTelegram } from "./telegram-renderer.js";

function message(blocks: BotMessage["blocks"], actions?: BotMessage["actions"]): BotMessage {
  return { direction: "ltr", blocks, ...(actions ? { actions } : {}) };
}

describe("renderTelegram", () => {
  it("header shows the tone marker and a bold, escaped title", () => {
    const rendered = renderTelegram(
      message([
        {
          type: "header",
          tone: "success",
          icon: "invoice",
          title: "Total <report> & more",
          subtitle: "A & B",
        },
      ]),
    );

    expect(rendered.text).toContain("🟢");
    expect(rendered.text).toContain("<b>Total &lt;report&gt; &amp; more</b>");
    expect(rendered.text).toContain("<i>A &amp; B</i>");
  });

  it("escapes <, & and > in text", () => {
    const rendered = renderTelegram(message([{ type: "text", text: "x < y & z > w" }]));

    expect(rendered.text).toBe("x &lt; y &amp; z &gt; w");
  });

  it("renders fields as <b>label:</b> value", () => {
    const rendered = renderTelegram(
      message([{ type: "fields", items: [{ label: "Total", value: "1,000 SAR" }] }]),
    );

    expect(rendered.text).toBe(`<b>Total:</b> ${isolate("1,000 SAR")}`);
  });

  it("turns each select option into its own button with the option action as callback_data", () => {
    const rendered = renderTelegram(
      message(
        [],
        [
          {
            items: [
              {
                type: "select",
                placeholder: "Pick one",
                options: [
                  { label: "One", action: "act:one" },
                  { label: "Two", icon: "next", action: "act:two" },
                ],
              },
            ],
          },
        ],
      ),
    );

    const keyboard = rendered.reply_markup?.inline_keyboard ?? [];
    expect(keyboard).toHaveLength(2);
    for (const row of keyboard) expect(row).toHaveLength(1);
    expect(keyboard.map((row) => row[0]?.callback_data)).toEqual(["act:one", "act:two"]);
  });

  it("renders a link as a url button", () => {
    const rendered = renderTelegram(
      message([], [{ items: [{ type: "link", label: "Open", url: "https://example.com/docs" }] }]),
    );

    const button = rendered.reply_markup?.inline_keyboard[0]?.[0];
    expect(button?.url).toBe("https://example.com/docs");
    expect(button?.callback_data).toBeUndefined();
  });

  it("keeps an over-long message within the limit and never ends inside an HTML tag", () => {
    const longText = "x".repeat(50);
    const blocks = Array.from({ length: 300 }, () => ({ type: "text" as const, text: longText, emphasis: "strong" as const }));

    const rendered = renderTelegram(message(blocks));

    expect(rendered.text.length).toBeLessThanOrEqual(TELEGRAM_TEXT_LIMIT);
    const opens = (rendered.text.match(/<b>/g) ?? []).length;
    const closes = (rendered.text.match(/<\/b>/g) ?? []).length;
    expect(opens).toBeGreaterThan(0);
    expect(opens).toBe(closes);
    expect(rendered.text.endsWith("…")).toBe(true);
    expect(rendered.text).not.toMatch(/<[^>]*$/);
  });
});
