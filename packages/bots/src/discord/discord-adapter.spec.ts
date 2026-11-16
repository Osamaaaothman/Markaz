import { generateKeyPairSync, sign } from "node:crypto";
import {
  AdapterError,
  type HttpFetch,
  type RawWebhookRequest,
  type WebhookParseResult,
} from "../contract/channel-adapter.js";
import type { InboundEvent } from "../contract/inbound.js";
import type { FormSpec } from "../contract/ui-kit.js";
import { DiscordAdapter } from "./discord-adapter.js";

const NOW = 1_700_000_000;
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const PUBLIC_KEY_HEX = (publicKey.export({ format: "der", type: "spki" }) as Buffer)
  .subarray(-32)
  .toString("hex");
const SECRETS = { publicKey: PUBLIC_KEY_HEX };

interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

const NO_FETCH: HttpFetch = () => {
  throw new Error("fetch must not be called");
};

function signedRequest(
  body: string,
  options: { timestamp?: string; signatureOver?: string } = {},
): RawWebhookRequest {
  const timestamp = options.timestamp ?? String(NOW);
  const signature = sign(
    null,
    Buffer.concat([
      Buffer.from(timestamp, "utf8"),
      Buffer.from(options.signatureOver ?? body, "utf8"),
    ]),
    privateKey,
  ).toString("hex");
  return {
    headers: {
      "x-signature-ed25519": signature,
      "x-signature-timestamp": timestamp,
    },
    rawBody: Buffer.from(body, "utf8"),
  };
}

function eventOf(result: WebhookParseResult): InboundEvent {
  if (result.status !== "event") throw new Error(`expected an event, got ${result.status}`);
  return result.event;
}

function interaction(data: Record<string, unknown>): string {
  return JSON.stringify({
    id: "interaction-1",
    token: "interaction-token",
    channel_id: "channel-1",
    guild_id: "guild-1",
    user: { id: "user-1", username: "alice" },
    ...data,
  });
}

describe("DiscordAdapter webhook parsing", () => {
  const adapter = new DiscordAdapter(NO_FETCH, () => NOW);

  it("accepts a valid PING and answers the handshake", () => {
    const result = adapter.parseWebhook(signedRequest(JSON.stringify({ type: 1 })), SECRETS);

    expect(result).toEqual({ status: "handshake", response: { type: 1 } });
  });

  it("rejects a tampered body", () => {
    const original = JSON.stringify({ type: 1 });
    const tampered = JSON.stringify({ type: 2, id: "forged" });
    const result = adapter.parseWebhook(
      signedRequest(tampered, { signatureOver: original }),
      SECRETS,
    );

    expect(result).toEqual({ status: "rejected", reason: "bad_signature" });
  });

  it("rejects a timestamp older than five minutes", () => {
    const oldTimestamp = String(NOW - 301);
    const result = adapter.parseWebhook(
      signedRequest(JSON.stringify({ type: 1 }), { timestamp: oldTimestamp }),
      SECRETS,
    );

    expect(result).toEqual({ status: "rejected", reason: "bad_signature" });
  });

  it("normalizes a type 2 command interaction", () => {
    const body = interaction({ type: 2, data: { name: "Menu" } });
    const event = eventOf(adapter.parseWebhook(signedRequest(body), SECRETS));

    expect(event.kind).toBe("command");
    if (event.kind !== "command") throw new Error("expected a command");
    expect(event.name).toBe("menu");
    expect(event.chat).toEqual({ chatId: "channel-1", isPrivate: false });
  });

  it("normalizes a type 3 button interaction to an action using custom_id", () => {
    const body = interaction({
      type: 3,
      data: { custom_id: "act:approve", component_type: 2 },
    });
    const event = eventOf(adapter.parseWebhook(signedRequest(body), SECRETS));

    expect(event.kind).toBe("action");
    if (event.kind !== "action") throw new Error("expected an action");
    expect(event.actionId).toBe("act:approve");
  });

  it("normalizes a type 3 select interaction to the selected option value", () => {
    const body = interaction({
      type: 3,
      data: { custom_id: "select:0", component_type: 3, values: ["act:selected"] },
    });
    const event = eventOf(adapter.parseWebhook(signedRequest(body), SECRETS));

    expect(event.kind).toBe("action");
    if (event.kind !== "action") throw new Error("expected an action");
    expect(event.actionId).toBe("act:selected");
  });

  it("normalizes a type 5 modal submission to form fields", () => {
    const body = interaction({
      type: 5,
      data: {
        custom_id: "form:reject",
        components: [
          { components: [{ custom_id: "reason", value: "Wrong price" }] },
          { components: [{ custom_id: "note", value: "Please fix" }] },
        ],
      },
    });
    const event = eventOf(adapter.parseWebhook(signedRequest(body), SECRETS));

    expect(event.kind).toBe("form");
    if (event.kind !== "form") throw new Error("expected a form");
    expect(event.actionId).toBe("form:reject");
    expect(event.fields).toEqual({ reason: "Wrong price", note: "Please fix" });
  });
});

describe("DiscordAdapter immediateResponse", () => {
  const adapter = new DiscordAdapter(NO_FETCH, () => NOW);
  const commandInGuild: InboundEvent = {
    provider: "discord",
    kind: "command",
    eventId: "dc:1",
    interactionToken: "token",
    sender: { id: "user-1" },
    chat: { chatId: "channel-1", isPrivate: false },
    name: "menu",
    args: "",
  };
  const actionInGuild: InboundEvent = {
    provider: "discord",
    kind: "action",
    eventId: "dc:2",
    interactionToken: "token",
    sender: { id: "user-1" },
    chat: { chatId: "channel-1", isPrivate: false },
    actionId: "act:approve",
  };

  it("defers a guild command with an ephemeral reply", () => {
    expect(adapter.immediateResponse(commandInGuild)).toEqual({ type: 5, data: { flags: 64 } });
  });

  it("defers an action as a message update", () => {
    expect(adapter.immediateResponse(actionInGuild)).toEqual({ type: 6 });
  });

  it("opens a modal when a form is supplied", () => {
    const spec: FormSpec = {
      title: "Reject",
      fields: [{ key: "reason", label: "Reason", multiline: true, required: true, maxLength: 500 }],
    };

    const response = adapter.immediateResponse(commandInGuild, { actionId: "form:reject", spec }) as {
      type: number;
      data: { custom_id: string };
    };

    expect(response.type).toBe(9);
    expect(response.data.custom_id).toBe("form:reject");
  });
});

describe("DiscordAdapter downloadFile", () => {
  it("rejects a url outside the Discord CDN without calling fetch", async () => {
    const calls: FetchCall[] = [];
    const fetchFn: HttpFetch = (url, init) => {
      calls.push({ url, init });
      return Promise.resolve(new Response("unexpected", { status: 200 }));
    };
    const adapter = new DiscordAdapter(fetchFn, () => NOW);

    const error = await adapter
      .downloadFile(
        { fileId: "file-1", fileName: "evil.txt", url: "https://evil.example.com/evil.txt" },
        SECRETS,
        1024,
      )
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AdapterError);
    expect(error).toMatchObject({ code: "BAD_REQUEST" });
    expect(calls).toHaveLength(0);
  });
});
