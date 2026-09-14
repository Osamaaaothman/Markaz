import type { Job } from "bullmq";
import { newId } from "@erp/shared";
import type { EmailMessage, EmailTransport } from "./email-transport.js";
import { createNotificationProcessor } from "./notification.job.js";
import type { OutboxJobData } from "../jobs/outbox-relay.js";

class RecordingTransport implements EmailTransport {
  sent: EmailMessage[] = [];
  send(message: EmailMessage): Promise<void> {
    this.sent.push(message);
    return Promise.resolve();
  }
}

function fakeJob(payload: unknown): Job<OutboxJobData> {
  return {
    data: {
      companyId: newId(),
      correlationId: newId(),
      outboxMessageId: newId(),
      payload,
    },
  } as Job<OutboxJobData>;
}

describe("createNotificationProcessor", () => {
  it("renders the template and sends it through the transport", async () => {
    const transport = new RecordingTransport();
    const processor = createNotificationProcessor(transport);

    await processor(
      fakeJob({
        to: "user@example.com",
        language: "en",
        recipientName: "Sara",
        companyName: "Markaz",
        message: "Your invoice is ready.",
      }),
    );

    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]?.to).toBe("user@example.com");
    expect(transport.sent[0]?.subject).toBe("Notice from Markaz");
  });

  it("rejects a malformed payload rather than silently sending garbage", async () => {
    const transport = new RecordingTransport();
    const processor = createNotificationProcessor(transport);

    await expect(processor(fakeJob({ to: "user@example.com" }))).rejects.toThrow(
      /Invalid notification payload/,
    );
    expect(transport.sent).toHaveLength(0);
  });

  it("rejects an unsupported language rather than defaulting silently", async () => {
    const transport = new RecordingTransport();
    const processor = createNotificationProcessor(transport);

    await expect(
      processor(
        fakeJob({
          to: "user@example.com",
          language: "fr",
          recipientName: "A",
          companyName: "B",
          message: "m",
        }),
      ),
    ).rejects.toThrow(/Invalid notification payload/);
  });
});
