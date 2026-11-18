import {
  AdapterError,
  type HttpFetch,
  type RawWebhookRequest,
} from "../contract/channel-adapter.js";
import type { BotMessage } from "../contract/ui-kit.js";
import { TELEGRAM_SECRET_HEADER, TelegramAdapter } from "./telegram-adapter.js";

const SECRETS = { botToken: "1:x", webhookSecret: "s3cret" };

interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function recorder(respond: (call: FetchCall) => Response): { calls: FetchCall[]; fetchFn: HttpFetch } {
  const calls: FetchCall[] = [];
  const fetchFn: HttpFetch = (url, init) => {
    const call: FetchCall = { url, init };
    calls.push(call);
    return Promise.resolve(respond(call));
  };
  return { calls, fetchFn };
}

function webhookRequest(body: unknown, headers: Record<string, string | undefined>): RawWebhookRequest {
  return { headers, rawBody: Buffer.from(JSON.stringify(body), "utf8") };
}

function textMessage(text: string, messageId = 5) {
  return {
    update_id: 100,
    message: {
      message_id: messageId,
      from: { id: 1, first_name: "Amina", username: "amina" },
      chat: { id: 1, type: "private" },
      text,
    },
  };
}

const SIMPLE_MESSAGE: BotMessage = {
  direction: "ltr",
  blocks: [{ type: "text", text: "Hello" }],
};

describe("TelegramAdapter webhook parsing", () => {
  const adapter = new TelegramAdapter();

  it("rejects a missing secret header", () => {
    const result = adapter.parseWebhook(webhookRequest(textMessage("/menu"), {}), SECRETS);
    expect(result).toEqual({ status: "rejected", reason: "bad_secret" });
  });

  it("rejects a wrong secret header", () => {
    const result = adapter.parseWebhook(
      webhookRequest(textMessage("/menu"), { [TELEGRAM_SECRET_HEADER]: "wrong" }),
      SECRETS,
    );
    expect(result).toEqual({ status: "rejected", reason: "bad_secret" });
  });

  it("normalizes /menu@my_bot to the command name menu", () => {
    const result = adapter.parseWebhook(
      webhookRequest(textMessage("/menu@my_bot"), { [TELEGRAM_SECRET_HEADER]: "s3cret" }),
      SECRETS,
    );

    expect(result.status).toBe("event");
    if (result.status !== "event") throw new Error("expected an event");
    expect(result.event.kind).toBe("command");
    if (result.event.kind !== "command") throw new Error("expected a command");
    expect(result.event.name).toBe("menu");
  });

  it("splits /start ABC into command start with args ABC", () => {
    const result = adapter.parseWebhook(
      webhookRequest(textMessage("/start ABC"), { [TELEGRAM_SECRET_HEADER]: "s3cret" }),
      SECRETS,
    );

    expect(result.status).toBe("event");
    if (result.status !== "event") throw new Error("expected an event");
    expect(result.event.kind).toBe("command");
    if (result.event.kind !== "command") throw new Error("expected a command");
    expect(result.event.name).toBe("start");
    expect(result.event.args).toBe("ABC");
  });

  it("normalizes a callback_query to an action with ackId and message ref", () => {
    const update = {
      update_id: 101,
      callback_query: {
        id: "cb-1",
        from: { id: 2, first_name: "Bilal" },
        data: "act:open",
        message: { message_id: 9, chat: { id: 2, type: "private" } },
      },
    };
    const result = adapter.parseWebhook(
      webhookRequest(update, { [TELEGRAM_SECRET_HEADER]: "s3cret" }),
      SECRETS,
    );

    expect(result.status).toBe("event");
    if (result.status !== "event") throw new Error("expected an event");
    expect(result.event.kind).toBe("action");
    if (result.event.kind !== "action") throw new Error("expected an action");
    expect(result.event.actionId).toBe("act:open");
    expect(result.event.ackId).toBe("cb-1");
    expect(result.event.message).toEqual({ chatId: "2", messageId: "9" });
  });

  it("uses the widest photo for a file event", () => {
    const update = {
      update_id: 102,
      message: {
        message_id: 11,
        from: { id: 3, first_name: "Carla" },
        chat: { id: 3, type: "private" },
        photo: [
          { file_id: "small", width: 90, file_size: 100 },
          { file_id: "widest", width: 1280, file_size: 5000 },
          { file_id: "medium", width: 640, file_size: 2000 },
        ],
      },
    };
    const result = adapter.parseWebhook(
      webhookRequest(update, { [TELEGRAM_SECRET_HEADER]: "s3cret" }),
      SECRETS,
    );

    expect(result.status).toBe("event");
    if (result.status !== "event") throw new Error("expected an event");
    expect(result.event.kind).toBe("file");
    if (result.event.kind !== "file") throw new Error("expected a file");
    expect(result.event.file.fileId).toBe("widest");
    expect(result.event.file.size).toBe(5000);
  });

  it("rejects an update without update_id as malformed", () => {
    const result = adapter.parseWebhook(
      webhookRequest(
        { message: { message_id: 1, chat: { id: 1, type: "private" }, text: "/menu" } },
        { [TELEGRAM_SECRET_HEADER]: "s3cret" },
      ),
      SECRETS,
    );

    expect(result).toEqual({ status: "rejected", reason: "malformed" });
  });
});

describe("TelegramAdapter HTTP", () => {
  it("send() posts to sendMessage with parse_mode HTML", async () => {
    const { calls, fetchFn } = recorder(() =>
      jsonResponse({ ok: true, result: { message_id: 42, chat: { id: 7, type: "private" } } }),
    );
    const adapter = new TelegramAdapter(fetchFn);

    const ref = await adapter.send({ chatId: "7", isPrivate: true }, SIMPLE_MESSAGE, SECRETS);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.telegram.org/bot1:x/sendMessage");
    expect(calls[0]?.init?.method).toBe("POST");
    const body = JSON.parse(calls[0]?.init?.body as string) as Record<string, unknown>;
    expect(body.parse_mode).toBe("HTML");
    expect(body.chat_id).toBe("7");
    expect(body.text).toBe("Hello");
    expect(ref).toEqual({ chatId: "7", messageId: "42" });
  });

  it("maps 429 with retry_after to RATE_LIMITED with retryAfterMs", async () => {
    const { fetchFn } = recorder(() =>
      jsonResponse(
        {
          ok: false,
          error_code: 429,
          description: "Too Many Requests: retry after 3",
          parameters: { retry_after: 3 },
        },
        429,
      ),
    );
    const adapter = new TelegramAdapter(fetchFn);

    const error = await adapter
      .send({ chatId: "7", isPrivate: true }, SIMPLE_MESSAGE, SECRETS)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AdapterError);
    expect(error).toMatchObject({ code: "RATE_LIMITED", retryAfterMs: 3000 });
  });

  it("maps 403 to BLOCKED", async () => {
    const { fetchFn } = recorder(() =>
      jsonResponse(
        { ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" },
        403,
      ),
    );
    const adapter = new TelegramAdapter(fetchFn);

    const error = await adapter
      .send({ chatId: "7", isPrivate: true }, SIMPLE_MESSAGE, SECRETS)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AdapterError);
    expect(error).toMatchObject({ code: "BLOCKED" });
  });

  it("edit() swallows 'message is not modified'", async () => {
    const { fetchFn } = recorder(() =>
      jsonResponse(
        {
          ok: false,
          error_code: 400,
          description: "Bad Request: message is not modified: specified new message content and reply markup are exactly the same",
        },
        400,
      ),
    );
    const adapter = new TelegramAdapter(fetchFn);

    await expect(
      adapter.edit({ chatId: "7", messageId: "9" }, SIMPLE_MESSAGE, SECRETS),
    ).resolves.toBeUndefined();
  });

  it("testConnection returns ok:false UNAUTHORIZED on 401 instead of throwing", async () => {
    const { fetchFn } = recorder(() =>
      jsonResponse({ ok: false, error_code: 401, description: "Unauthorized" }, 401),
    );
    const adapter = new TelegramAdapter(fetchFn);

    const result = await adapter.testConnection(SECRETS);

    expect(result).toMatchObject({ ok: false, code: "UNAUTHORIZED" });
  });
});
