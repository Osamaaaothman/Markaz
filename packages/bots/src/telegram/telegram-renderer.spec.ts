import type { BotMessage } from "../contract/ui-kit.js";
import { TELEGRAM_TEXT_LIMIT, renderTelegram, renderTelegramPrompt } from "./telegram-renderer.js";

function message(blocks: BotMessage["blocks"], actions?: BotMessage["actions"]): BotMessage {
  return { direction: "ltr", blocks, ...(actions ? { actions } : {}) };
}

describe("renderTelegram", () => {
  it("header shows one icon and a bold, escaped title", () => {
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

    expect(rendered.text.startsWith("🧾 <b>Total &lt;report&gt; &amp; more</b>")).toBe(true);
    expect(rendered.text).not.toContain("🟢");
    expect(rendered.text).toContain("<i>A &amp; B</i>");
  });

  it("escapes <, & and > in text", () => {
    const rendered = renderTelegram(message([{ type: "text", text: "x < y & z > w" }]));

    expect(rendered.text).toBe("x &lt; y &amp; z &gt; w");
  });

  it("renders fields as a quote card: copyable values in <code>, key figures bold, status dots", () => {
    const rendered = renderTelegram(
      message([
        {
          type: "fields",
          items: [
            { label: "No.", value: "INV-1", copy: true },
            { label: "Total", value: "1,000 SAR", strong: true },
            { label: "Paid", value: "No", tone: "danger" },
            { label: "Note", value: "a < b" },
          ],
        },
      ]),
    );

    expect(rendered.text).toBe(
      "<blockquote>No.: <code>INV-1</code>\nTotal: <b>1,000 SAR</b>\n🔴 Paid: No\nNote: a &lt; b</blockquote>",
    );
    // No invisible bidi marks — they end up in whatever the user copies.
    expect(rendered.text).not.toMatch(/[\u2066-\u2069]/);
  });

  it("folds a long list into an expandable quote", () => {
    const items = Array.from({ length: 8 }, (_, i) => ({ title: `Line ${i}`, detail: "d" }));
    const rendered = renderTelegram(message([{ type: "list", items }]));

    expect(rendered.text.startsWith("<blockquote expandable>")).toBe(true);
    expect(rendered.text).toContain("▸ <b>Line 0</b>");
  });

  it("renders a reply prompt with an escaped title and hint", () => {
    expect(renderTelegramPrompt({ title: "Find <x>", hint: "Type a name" })).toBe("🔍 <b>Find &lt;x&gt;</b>\n<i>Type a name</i>");
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
