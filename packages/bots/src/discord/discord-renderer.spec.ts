import type { BotMessage, FormSpec } from "../contract/ui-kit.js";
import { renderDiscord, renderDiscordModal } from "./discord-renderer.js";

function message(blocks: BotMessage["blocks"], actions?: BotMessage["actions"], brandColor?: string): BotMessage {
  return {
    direction: "ltr",
    blocks,
    ...(actions ? { actions } : {}),
    ...(brandColor ? { brandColor } : {}),
  };
}

interface ButtonShape {
  type: number;
  style: number;
  label: string;
  custom_id?: string;
  url?: string;
}

interface ModalShape {
  type: number;
  data: {
    custom_id: string;
    title: string;
    components: Array<{
      type: number;
      components: Array<{
        type: number;
        custom_id: string;
        style: number;
        required: boolean;
        max_length: number;
      }>;
    }>;
  };
}

describe("renderDiscord", () => {
  it("maps the success tone to the success embed colour", () => {
    const rendered = renderDiscord(
      message([{ type: "header", tone: "success", icon: "check", title: "Saved" }]),
    );

    expect(rendered.embeds[0]?.color).toBe(0x2e7d32);
    expect(rendered.embeds[0]?.title).toContain("Saved");
  });

  it("uses message.brandColor for the brand tone", () => {
    const rendered = renderDiscord(
      message(
        [{ type: "header", tone: "brand", icon: "settings", title: "Acme" }],
        undefined,
        "#112233",
      ),
    );

    expect(rendered.embeds[0]?.color).toBe(0x112233);
  });

  it("maps button styles primary=1, danger=4 and link=5", () => {
    const rendered = renderDiscord(
      message(
        [],
        [
          {
            items: [
              { type: "button", style: "primary", label: "Go", action: "act:go" },
              { type: "button", style: "danger", label: "Delete", action: "act:delete" },
              { type: "link", label: "Docs", url: "https://example.com/docs" },
            ],
          },
        ],
      ),
    );

    expect(rendered.components).toHaveLength(1);
    const buttons = rendered.components[0]?.components as ButtonShape[];
    expect(buttons.map((button) => button.style)).toEqual([1, 4, 5]);
    expect(buttons[0]?.custom_id).toBe("act:go");
    expect(buttons[2]?.url).toBe("https://example.com/docs");
  });

  it("splits more than five buttons into rows of five", () => {
    const items = Array.from({ length: 7 }, (_, index) => ({
      type: "button" as const,
      style: "secondary" as const,
      label: `Button ${index + 1}`,
      action: `act:${index + 1}`,
    }));

    const rendered = renderDiscord(message([{ type: "text", text: "Pick" }], [{ items }]));

    expect(rendered.components).toHaveLength(2);
    expect(rendered.components[0]?.components).toHaveLength(5);
    expect(rendered.components[1]?.components).toHaveLength(2);
  });

  it("gives a select its own row with type 3 and option values equal to action ids", () => {
    const rendered = renderDiscord(
      message(
        [],
        [
          {
            items: [
              { type: "button", style: "primary", label: "Refresh", action: "act:refresh" },
              {
                type: "select",
                placeholder: "Choose",
                options: [
                  { label: "Alpha", action: "act:alpha" },
                  { label: "Beta", action: "act:beta" },
                ],
              },
            ],
          },
        ],
      ),
    );

    expect(rendered.components).toHaveLength(2);
    const selectRow = rendered.components[1];
    expect(selectRow?.components).toHaveLength(1);
    const select = selectRow?.components[0];
    expect(select?.type).toBe(3);
    if (select?.type !== 3) throw new Error("expected a select component");
    expect(select.options.map((option) => option.value)).toEqual(["act:alpha", "act:beta"]);
  });
});

describe("renderDiscordModal", () => {
  it("returns a type 9 modal with the action id and one text input per field", () => {
    const spec: FormSpec = {
      title: "Reject invoice",
      fields: [
        { key: "reason", label: "Reason", multiline: true, required: true, maxLength: 500 },
        { key: "note", label: "Note", multiline: false, required: false, maxLength: 100 },
      ],
    };

    const modal = renderDiscordModal("form:reject", spec) as ModalShape;

    expect(modal.type).toBe(9);
    expect(modal.data.custom_id).toBe("form:reject");
    expect(modal.data.components).toHaveLength(2);
    expect(modal.data.components[0]?.components[0]?.type).toBe(4);
    expect(modal.data.components[0]?.components[0]?.custom_id).toBe("reason");
    expect(modal.data.components[1]?.components[0]?.custom_id).toBe("note");
  });
});
