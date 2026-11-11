import { Module } from "@nestjs/common";
import { createWorkerLogger } from "../jobs/worker-logger.js";
import { createEmailTransportFromEnv, type EmailTransport } from "./email-transport.js";

export const EMAIL_TRANSPORT = Symbol("EmailTransport");

// The same SMTP transport the notification worker uses (see worker.ts), made available inside the
// main API process too — for the one case that needs to send from an HTTP request rather than a
// queued job: a user explicitly confirming "send this now" after previewing it (docs/02
// §6 is about system-triggered notifications tied to a business-event transaction; a deliberate,
// human-confirmed send is a different thing and does not need outbox durability or retry).
@Module({
  providers: [{ provide: EMAIL_TRANSPORT, useFactory: (): EmailTransport => createEmailTransportFromEnv(process.env, createWorkerLogger()) }],
  exports: [EMAIL_TRANSPORT],
})
export class MailModule {}
