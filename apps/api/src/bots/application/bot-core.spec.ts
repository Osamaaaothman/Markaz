import { BOT_KEY_ENV, parseBotsConfig } from "../bots.config.js";
import { AdapterRegistry, BotError, BotVault, asLanguage, maskSecret, randomToken } from "./bot-core.js";

const VALID_KEY = Buffer.alloc(32, 7).toString("base64");
const ORIGINAL_KEY = process.env[BOT_KEY_ENV];

afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env[BOT_KEY_ENV];
  else process.env[BOT_KEY_ENV] = ORIGINAL_KEY;
});

function catchError(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error("Expected the call to throw");
}

describe("BotVault", () => {
  it("round-trips connection secrets and keeps the plaintext out of the sealed bytes", () => {
    process.env[BOT_KEY_ENV] = VALID_KEY;
    const vault = new BotVault();
    const secrets = { botToken: "123:abc", webhookSecret: "s" };

    const sealed = vault.seal(secrets);

    expect(vault.isConfigured()).toBe(true);
    expect(vault.open(sealed)).toEqual(secrets);
    expect(Buffer.from(sealed).toString("utf8")).not.toContain("123:abc");
  });

  it("refuses to seal without a configured key", () => {
    delete process.env[BOT_KEY_ENV];
    const vault = new BotVault();

    const error = catchError(() => vault.seal({ botToken: "123:abc" }));

    expect(error).toBeInstanceOf(BotError);
    expect((error as BotError).code).toBe("ENCRYPTION_KEY_MISSING");
    expect(vault.isConfigured()).toBe(false);
  });
});

describe("maskSecret", () => {
  it("shows only the last four characters of a long secret", () => {
    expect(maskSecret("1234567890:ABCDEFGHIJ")).toEqual({ set: true, last4: "GHIJ" });
  });

  it("shows nothing for a short secret but still records that one is set", () => {
    expect(maskSecret("short")).toEqual({ set: true, last4: null });
  });

  it("reports an absent secret", () => {
    expect(maskSecret(undefined)).toEqual({ set: false, last4: null });
  });
});

describe("randomToken", () => {
  it("produces URL-safe tokens of the expected length that differ per call", () => {
    const first = randomToken(16);
    const second = randomToken(16);

    expect(first).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(second).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(first).not.toBe(second);
  });
});

describe("asLanguage", () => {
  it("maps only Arabic to Arabic and everything else to English", () => {
    expect(asLanguage("ar")).toBe("ar");
    expect(asLanguage("fr")).toBe("en");
    expect(asLanguage(null)).toBe("en");
  });
});

describe("AdapterRegistry", () => {
  it("returns the adapter for a known provider", () => {
    expect(new AdapterRegistry().get("telegram").provider).toBe("telegram");
  });

  it("rejects an unknown provider", () => {
    const error = catchError(() => new AdapterRegistry().get("slack"));

    expect(error).toBeInstanceOf(BotError);
    expect((error as BotError).code).toBe("UNKNOWN_PROVIDER");
  });
});

describe("parseBotsConfig", () => {
  it("accepts an HTTP(S) public URL and strips trailing slashes", () => {
    expect(parseBotsConfig({ BOTS_PUBLIC_API_URL: "https://erp.example.com/api/" }).publicApiBaseUrl).toBe(
      "https://erp.example.com/api",
    );
  });

  it("rejects a non-HTTP URL", () => {
    expect(parseBotsConfig({ BOTS_PUBLIC_API_URL: "ftp://x" }).publicApiBaseUrl).toBeNull();
  });

  it("enables the runtime unless it is explicitly off", () => {
    expect(parseBotsConfig({ BOTS_RUNTIME: "off" }).runtimeEnabled).toBe(false);
    expect(parseBotsConfig({}).runtimeEnabled).toBe(true);
  });
});
