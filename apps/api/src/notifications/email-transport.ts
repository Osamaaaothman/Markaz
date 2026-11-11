import nodemailer, { type Transporter } from "nodemailer";
import type pino from "pino";

export interface EmailAttachment {
  readonly filename: string;
  readonly content: Buffer;
  readonly contentType: string;
}

export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  readonly attachments?: readonly EmailAttachment[];
}

export interface EmailTransport {
  readonly configured?: boolean;
  send(message: EmailMessage): Promise<void>;
}

export class EmailDeliveryError extends Error {
  constructor(readonly code: "EMAIL_NOT_CONFIGURED" | "EMAIL_DELIVERY_FAILED") {
    super(code);
  }
}

// docs/09-SECURITY-RULES.md §7: never log a recipient's full address or message
// content, only that a send was attempted/skipped.
export function redactAddress(to: string): string {
  const at = to.indexOf("@");
  return at === -1 ? "[redacted]" : `${to.slice(0, 1)}***${to.slice(at)}`;
}

// Missing configuration is a delivery failure, never a successful send. The API
// reports it explicitly and the worker retains its normal retry/failure semantics.
export class LoggingEmailTransport implements EmailTransport {
  readonly configured = false;
  constructor(private readonly logger: pino.Logger) {}

  send(message: EmailMessage): Promise<void> {
    this.logger.warn(
      { to: redactAddress(message.to) },
      "email.not_sent_unconfigured",
    );
    return Promise.reject(new EmailDeliveryError("EMAIL_NOT_CONFIGURED"));
  }
}

export class SmtpEmailTransport implements EmailTransport {
  readonly configured = true;
  constructor(
    private readonly transporter: Transporter,
    private readonly fromAddress: string,
  ) {}

  async send(message: EmailMessage): Promise<void> {
    const result = await this.transporter.sendMail({
      from: this.fromAddress,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
      ...(message.attachments
        ? { attachments: message.attachments.map((a) => ({ filename: a.filename, content: a.content, contentType: a.contentType })) }
        : {}),
    });
    if (Array.isArray(result.rejected) && result.rejected.length > 0) throw new EmailDeliveryError("EMAIL_DELIVERY_FAILED");
  }
}

export interface SmtpConfig {
  readonly host: string;
  readonly port: number;
  readonly secure: boolean;
  readonly user?: string;
  readonly password?: string;
  readonly fromAddress: string;
}

export function createEmailTransport(
  config: SmtpConfig | null,
  logger: pino.Logger,
): EmailTransport {
  if (config === null) {
    return new LoggingEmailTransport(logger);
  }
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
    ...(config.user !== undefined && config.password !== undefined
      ? { auth: { user: config.user, pass: config.password } }
      : {}),
  });
  return new SmtpEmailTransport(transporter, config.fromAddress);
}

// HTTPS works on Railway Hobby, where outbound SMTP is unavailable. Never log provider response bodies or credentials.
export class ResendEmailTransport implements EmailTransport {
  readonly configured = true;
  constructor(private readonly apiKey: string, private readonly fromAddress: string, private readonly request: typeof fetch = fetch) {}

  async send(message: EmailMessage): Promise<void> {
    try {
      const response = await this.request("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(15_000),
        body: JSON.stringify({ from: this.fromAddress, to: [message.to], subject: message.subject,
          html: message.html, text: message.text,
          ...(message.attachments ? { attachments: message.attachments.map((a) => ({ filename: a.filename, content: a.content.toString("base64"), content_type: a.contentType })) } : {}),
        }),
      });
      if (!response.ok) throw new EmailDeliveryError("EMAIL_DELIVERY_FAILED");
      const body: unknown = await response.json();
      if (!body || typeof body !== "object" || !("id" in body) || typeof body.id !== "string" || !body.id) throw new EmailDeliveryError("EMAIL_DELIVERY_FAILED");
    } catch {
      throw new EmailDeliveryError("EMAIL_DELIVERY_FAILED");
    }
  }
}

export function createEmailTransportFromEnv(env: NodeJS.ProcessEnv, logger: pino.Logger): EmailTransport {
  if (env.EMAIL_PROVIDER === "resend") {
    const key = env.RESEND_API_KEY?.trim();
    const from = env.EMAIL_FROM_ADDRESS?.trim();
    return key && from ? new ResendEmailTransport(key, from) : new LoggingEmailTransport(logger);
  }
  if (env.EMAIL_PROVIDER && env.EMAIL_PROVIDER !== "smtp") return new LoggingEmailTransport(logger);
  return createEmailTransport(readSmtpConfigFromEnv(env), logger);
}

export function readSmtpConfigFromEnv(env: NodeJS.ProcessEnv): SmtpConfig | null {
  const host = env.SMTP_HOST;
  const fromAddress = env.SMTP_FROM_ADDRESS;
  if (
    host === undefined ||
    host.length === 0 ||
    fromAddress === undefined ||
    fromAddress.length === 0
  ) {
    return null;
  }
  return {
    host,
    port: env.SMTP_PORT !== undefined ? Number.parseInt(env.SMTP_PORT, 10) : 587,
    secure: env.SMTP_SECURE === "true",
    ...(env.SMTP_USER !== undefined ? { user: env.SMTP_USER } : {}),
    ...(env.SMTP_PASSWORD !== undefined ? { password: env.SMTP_PASSWORD } : {}),
    fromAddress,
  };
}
