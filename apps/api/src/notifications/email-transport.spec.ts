import nodemailer from "nodemailer";
import pino from "pino";
import {
  createEmailTransport,
  LoggingEmailTransport,
  readSmtpConfigFromEnv,
  SmtpEmailTransport,
} from "./email-transport.js";

function silentLogger(): pino.Logger {
  return pino({ enabled: false });
}

describe("LoggingEmailTransport", () => {
  it("never throws and never logs the full recipient address", async () => {
    const entries: unknown[] = [];
    const logger = pino({ level: "warn" }, {
      write: (line: string) => entries.push(JSON.parse(line)),
    } as unknown as NodeJS.WritableStream);
    const transport = new LoggingEmailTransport(logger);

    await expect(
      transport.send({ to: "someone@example.com", subject: "s", html: "<p>h</p>", text: "t" }),
    ).resolves.toBeUndefined();

    expect(entries).toHaveLength(1);
    const entry = entries[0] as { to: string };
    expect(entry.to).not.toBe("someone@example.com");
    expect(entry.to).toContain("@example.com");
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
