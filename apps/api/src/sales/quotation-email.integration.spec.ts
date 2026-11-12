import { newId } from "@erp/shared";
import { QuotationEmailService } from "./quotation-email.service.js";
import { PrismaClient } from "@erp/db";
import {
  EmailDeliveryError,
  ResendEmailTransport,
  type EmailTransport,
} from "../notifications/email-transport.js";

(process.env.DATABASE_URL ? describe : describe.skip)(
  "Quotation email history — real PostgreSQL",
  () => {
    const db = new PrismaClient();
    const companyId = newId();
    const quotationId = newId();
    const actor = { id: newId(), companyId };
    let calls = 0;
    let event = "delivered";
    const transport = new ResendEmailTransport("test-key", "sales@example.test", (_url, init) => {
      if (init?.method === "POST") {
        calls++;
        expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBeTruthy();
        return Promise.resolve(new Response(JSON.stringify({ id: "message-qa" }), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({ last_event: event }), { status: 200 }));
    });
    const service = new QuotationEmailService(db, transport);
    const input = { to: "buyer@example.test", language: "ar" };
    const prepare = () =>
      Promise.resolve({
        to: input.to,
        subject: "عرض سعر",
        html: "<p>QA</p>",
        text: "QA",
        attachments: [
          {
            filename: "quote.pdf",
            contentType: "application/pdf",
            content: Buffer.from("%PDF-test"),
          },
        ],
      });
    beforeAll(async () => {
      await db.company.create({
        data: { id: companyId, name: "Email QA", defaultCurrency: "SAR" },
      });
      await db.user.create({
        data: { ...actor, ref: "USR-1", email: `${actor.id}@example.test`, passwordHash: "unused" },
      });
      const customerId = newId();
      await db.party.create({
        data: { id: customerId, companyId, ref: "P-1", kind: "COMPANY", name: "Buyer" },
      });
      await db.quotation.create({
        data: {
          id: quotationId,
          companyId,
          customerId,
          number: "QUO-QA",
          status: "OPEN",
          quotationDate: new Date(),
          currency: "SAR",
          totalNet: "1",
          totalTax: "0",
          totalGross: "1",
          createdBy: actor.id,
          correlationId: newId(),
        },
      });
    });
    afterAll(() => db.$disconnect());
    it("sends only once per key, stores recipient/time and distinguishes accepted from delivered", async () => {
      const key = newId();
      const first = await service.send(quotationId, input, actor, newId(), key, prepare);
      const second = await service.send(quotationId, input, actor, newId(), key, prepare);
      expect(second.attemptId).toBe(first.attemptId);
      expect(calls).toBe(1);
      expect((await service.history(companyId, quotationId)).data[0]).toMatchObject({
        recipient: input.to,
        status: "ACCEPTED",
        subject: "عرض سعر",
        language: "ar",
      });
      expect(
        await service.refresh(companyId, quotationId, first.attemptId, actor.id, newId()),
      ).toMatchObject({ status: "DELIVERED" });
      event = "sent";
      expect(
        await service.refresh(companyId, quotationId, first.attemptId, actor.id, newId()),
      ).toMatchObject({ status: "DELIVERED" });
      await expect(
        service.send(
          quotationId,
          { ...input, to: "other@example.test" },
          actor,
          newId(),
          key,
          prepare,
        ),
      ).rejects.toMatchObject({ status: 409 });
      expect(
        await db.auditLog.count({ where: { companyId, action: "quotation.email_requested" } }),
      ).toBe(1);
      // A deliberate resend has a fresh key and its own history row.
      await service.send(quotationId, input, actor, newId(), newId(), prepare);
      expect(calls).toBe(2);
    });
    it("isolates history, delivery refresh and send by company", async () => {
      const attempt = (await service.history(companyId, quotationId)).data[0]!;
      await expect(service.history(newId(), quotationId)).rejects.toMatchObject({ status: 404 });
      await expect(
        service.refresh(newId(), quotationId, attempt.id, actor.id, newId()),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        service.send(
          quotationId,
          input,
          { ...actor, companyId: newId() },
          newId(),
          newId(),
          prepare,
        ),
      ).rejects.toMatchObject({ status: 404 });
    });
    it("records definite rejection and uncertain network outcomes without automatic duplicate sends", async () => {
      for (const [code, status] of [
        ["EMAIL_DELIVERY_FAILED", "FAILED"],
        ["EMAIL_DELIVERY_UNCERTAIN", "UNKNOWN"],
      ] as const) {
        let attempts = 0;
        const failing: EmailTransport = {
          send: () => {
            attempts++;
            return Promise.reject(new EmailDeliveryError(code));
          },
        };
        const sender = new QuotationEmailService(db, failing);
        const key = newId();
        await expect(
          sender.send(quotationId, input, actor, newId(), key, prepare),
        ).rejects.toMatchObject({ status: 503 });
        expect(
          (
            await db.quotationEmailAttempt.findUniqueOrThrow({
              where: { companyId_requestKey: { companyId, requestKey: key } },
            })
          ).status,
        ).toBe(status);
        await expect(
          sender.send(quotationId, input, actor, newId(), key, prepare),
        ).rejects.toMatchObject({ status: 409 });
        expect(attempts).toBe(1);
      }
    });
    it("keeps a failed attempt when preparation or configuration prevents delivery", async () => {
      const key = newId();
      const disabled: EmailTransport = {
        configured: false,
        send: () => Promise.reject(new Error("must not send")),
      };
      await expect(
        new QuotationEmailService(db, disabled).send(
          quotationId,
          input,
          actor,
          newId(),
          key,
          prepare,
        ),
      ).rejects.toMatchObject({ status: 503 });
      expect(
        await db.quotationEmailAttempt.findUnique({
          where: { companyId_requestKey: { companyId, requestKey: key } },
        }),
      ).toMatchObject({ status: "FAILED", errorCode: "EMAIL_NOT_CONFIGURED" });
    });
  },
);
