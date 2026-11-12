import nodemailer from "nodemailer";
import pino from "pino";
import {
  createEmailTransport,
  LoggingEmailTransport,
  readSmtpConfigFromEnv,
  SmtpEmailTransport,
  ResendEmailTransport,
  createEmailTransportFromEnv,
} from "./email-transport.js";

function silentLogger(): pino.Logger {
  return pino({ enabled: false });
}

describe("LoggingEmailTransport", () => {
  it("refuses an unconfigured send and never logs the full recipient address", async () => {
    const entries: unknown[] = [];
    const logger = pino({ level: "warn" }, {
      write: (line: string) => entries.push(JSON.parse(line)),
    } as unknown as NodeJS.WritableStream);
    const transport = new LoggingEmailTransport(logger);

    await expect(
      transport.send({ to: "someone@example.com", subject: "s", html: "<p>h</p>", text: "t" }),
    ).rejects.toMatchObject({ code: "EMAIL_NOT_CONFIGURED" });

    expect(entries).toHaveLength(1);
    const entry = entries[0] as { to: string };
    expect(entry.to).not.toBe("someone@example.com");
    expect(entry.to).toContain("@example.com");
  });
});

describe("ResendEmailTransport", () => {
  it.each([["sent", "ACCEPTED"], ["delivered", "DELIVERED"], ["bounced", "BOUNCED"], ["delivery_delayed", "DELAYED"], ["complained", "COMPLAINED"]])("maps delivery observation %s independently of send acceptance", async (event, expected) => {
    const transport = new ResendEmailTransport("test", "sender@example.test", () => Promise.resolve(new Response(JSON.stringify({ last_event: event }), { status: 200 })));
    expect(await transport.deliveryStatus("id")).toBe(expected);
  });
  it("does not invent a delivery status when the provider is unavailable", async () => {
    const transport = new ResendEmailTransport("test", "sender@example.test", () => Promise.resolve(new Response("private", { status: 403 })));
    expect(await transport.deliveryStatus("id")).toBeNull();
  });
  it("sends the PDF as base64 over HTTPS and requires provider acceptance", async () => {
    let body: Record<string, unknown> = {};
    const request: typeof fetch = (url, init) => {
      expect(url).toBe("https://api.resend.com/emails");
      expect(init?.method).toBe("POST");
      expect(init?.signal).toBeDefined();
      if (typeof init?.body !== "string") throw new Error("Expected a JSON request body");
      body = JSON.parse(init.body) as Record<string, unknown>;
      return Promise.resolve(new Response(JSON.stringify({ id: "test-message" }), { status: 200 }));
    };
    await new ResendEmailTransport("test-key", "sales@example.test", request).send({ to: "buyer@example.test", subject: "Quotation", html: "<p>Quotation</p>", text: "Quotation", attachments: [{ filename: "quotation.pdf", content: Buffer.from("%PDF-test"), contentType: "application/pdf" }] });
    expect(body).toMatchObject({ from: "sales@example.test", to: ["buyer@example.test"], attachments: [{ filename: "quotation.pdf", content: Buffer.from("%PDF-test").toString("base64"), content_type: "application/pdf" }] });
  });

  it.each([401, 429, 500])("never reports a provider %s response as sent", async (status) => {
    const request: typeof fetch = () => Promise.resolve(new Response("private provider details", { status }));
    await expect(new ResendEmailTransport("test-key", "sales@example.test", request).send({ to: "buyer@example.test", subject: "q", html: "q", text: "q" })).rejects.toMatchObject({ message: status >= 500 ? "EMAIL_DELIVERY_UNCERTAIN" : "EMAIL_DELIVERY_FAILED" });
  });

  it("requires an API key and sender without falling back to another provider", () => {
    expect(createEmailTransportFromEnv({ EMAIL_PROVIDER: "resend" }, silentLogger()).configured).toBe(false);
    expect(createEmailTransportFromEnv({ EMAIL_PROVIDER: "resend", RESEND_API_KEY: "test-key", EMAIL_FROM_ADDRESS: "sales@example.test" }, silentLogger())).toBeInstanceOf(ResendEmailTransport);
  });
});

describe("SmtpEmailTransport", () => {
  it("hands the message to the transporter with the configured from address", async () => {
    const transporter = nodemailer.createTransport({ jsonTransport: true });
    const transport = new SmtpEmailTransport(transporter, "no-reply@markaz.test");

    // jsonTransport doesn't actually send — it returns the composed message as
    // JSON, which is exactly what lets this test assert real nodemailer behaviour
    // without a real SMTP server (docs/10-TESTING-RULES.md §1's "use the real
    // thing" spirit, applied to a library boundary rather than a database).
    let captured: unknown;
    const originalSendMail = transporter.sendMail.bind(transporter);
    transporter.sendMail = async (mail: Parameters<typeof originalSendMail>[0]) => {
      const info = await originalSendMail(mail);
      if (typeof info.message !== "string") {
        throw new Error("expected jsonTransport to return a string message");
      }
      captured = JSON.parse(info.message);
      return info;
    };

    await transport.send({ to: "user@example.com", subject: "Hi", html: "<p>Hi</p>", text: "Hi" });

    expect(captured).toMatchObject({
      from: { address: "no-reply@markaz.test" },
      to: [{ address: "user@example.com" }],
      subject: "Hi",
      html: "<p>Hi</p>",
      text: "Hi",
    });
  });
});

describe("createEmailTransport", () => {
  it("returns a LoggingEmailTransport when no SMTP config is given", () => {
    expect(createEmailTransport(null, silentLogger())).toBeInstanceOf(LoggingEmailTransport);
  });

  it("returns an SmtpEmailTransport when SMTP config is given", () => {
    const transport = createEmailTransport(
      { host: "smtp.example.com", port: 587, secure: false, fromAddress: "no-reply@markaz.test" },
      silentLogger(),
    );
    expect(transport).toBeInstanceOf(SmtpEmailTransport);
  });
});

describe("readSmtpConfigFromEnv", () => {
  it("returns null when SMTP_HOST is unset — the documented 'unconfigured' state", () => {
    expect(readSmtpConfigFromEnv({})).toBeNull();
  });

  it("returns null when SMTP_HOST is set but SMTP_FROM_ADDRESS is not", () => {
    expect(readSmtpConfigFromEnv({ SMTP_HOST: "smtp.example.com" })).toBeNull();
  });

  it("parses a full config, defaulting port 587 and secure false", () => {
    const config = readSmtpConfigFromEnv({
      SMTP_HOST: "smtp.example.com",
      SMTP_FROM_ADDRESS: "no-reply@markaz.test",
    });
    expect(config).toEqual({
      host: "smtp.example.com",
      port: 587,
      secure: false,
      fromAddress: "no-reply@markaz.test",
    });
  });

  it("parses explicit port/secure/auth", () => {
    const config = readSmtpConfigFromEnv({
      SMTP_HOST: "smtp.example.com",
      SMTP_PORT: "465",
      SMTP_SECURE: "true",
      SMTP_USER: "u",
      SMTP_PASSWORD: "p",
      SMTP_FROM_ADDRESS: "no-reply@markaz.test",
    });
    expect(config).toEqual({
      host: "smtp.example.com",
      port: 465,
      secure: true,
      user: "u",
      password: "p",
      fromAddress: "no-reply@markaz.test",
    });
  });
});
