import nodemailer, { type Transporter } from "nodemailer";
import type pino from "pino";

export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

export interface EmailTransport {
  send(message: EmailMessage): Promise<void>;
}

// docs/09-SECURITY-RULES.md §7: never log a recipient's full address or message
// content, only that a send was attempted/skipped.
function redactAddress(to: string): string {
  const at = to.indexOf("@");
  return at === -1 ? "[redacted]" : `${to.slice(0, 1)}***${to.slice(at)}`;
}

// docs/01-OPEN-DECISIONS.md: SMTP is a protocol, not a vendor — configuring
// SMTP_HOST/PORT/USER/PASS lets Osama point this at any provider (SES, SendGrid,
// Postmark, or a customer's own mail server) without a code change or picking one
// here. Same "never crash on missing config" pattern as ActivationServiceClient
// (packages/core/src/licensing/activation-client.ts): an unconfigured deployment
// just logs instead of sending, rather than the worker crashing on every job.
export class LoggingEmailTransport implements EmailTransport {
  constructor(private readonly logger: pino.Logger) {}

  send(message: EmailMessage): Promise<void> {
    this.logger.warn(
      { to: redactAddress(message.to), subject: message.subject },
      "email.not_sent_smtp_unconfigured",
    );
    return Promise.resolve();
  }
}

export class SmtpEmailTransport implements EmailTransport {
  constructor(
    private readonly transporter: Transporter,
    private readonly fromAddress: string,
  ) {}

  async send(message: EmailMessage): Promise<void> {
    await this.transporter.sendMail({
      from: this.fromAddress,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
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
    ...(config.user !== undefined && config.password !== undefined
      ? { auth: { user: config.user, pass: config.password } }
      : {}),
  });
  return new SmtpEmailTransport(transporter, config.fromAddress);
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
