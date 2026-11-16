import { SalesError } from "@erp/core";
import type { BotFeature } from "../application/bot-context.js";
import { BotNotice } from "../application/bot-runtime.js";
import { card, todayIso, type BotServices } from "./feature-kit.js";

// Documents as files (docs/BOTS-INTEGRATION-PLAN.md §5.4): the very same PDFs the web app produces,
// in the user's language. Every file handed out is audited.

export function createDocumentsFeature(services: BotServices): BotFeature {
  return {
    key: "documents",
    toggle: "documents",
    actions: {
      invoice: async (ctx, p) => {
        if (!(await ctx.can("read", "sales_invoice"))) throw new BotNotice("errors.forbidden", {}, "danger");
        let pdf;
        try {
          pdf = await services.invoicePdfs.render(ctx.connection.companyId, p["id"] ?? "", ctx.language);
        } catch (error) {
          if (error instanceof SalesError) throw new BotNotice("lookups.notFound");
          throw error;
        }
        await ctx.replyFile(
          { fileName: pdf.fileName, contentType: "application/pdf", bytes: new Uint8Array(pdf.bytes) },
          card(ctx, [{ type: "text", text: ctx.t("documents.invoiceCaption", { number: pdf.fileName.replace(/\.pdf$/, "") }) }]),
        );
        await services.runtime?.auditBotAction(ctx, "bot.document.sent", "SalesInvoice", p["id"] ?? "", { document: "invoice_pdf" });
      },
      statement: async (ctx, p) => {
        if (!(await ctx.can("read", "party_statement"))) throw new BotNotice("errors.forbidden", {}, "danger");
        const partyId = p["partyId"] ?? "";
        const party = await services.prisma.party.findFirst({ where: { id: partyId, companyId: ctx.connection.companyId }, select: { id: true } });
        if (!party) throw new BotNotice("lookups.notFound");
        const today = todayIso(ctx.connection.timezone);
        const year = today.slice(0, 4);
        // The current calendar year to date — the same default range the statement screen opens with.
        const statement = await services.statements.statement(ctx.connection.companyId, party.id, "SALES", new Date(`${year}-01-01T00:00:00Z`), new Date(`${today}T00:00:00Z`));
        const file = await services.receivablesExport.statement(ctx.connection.companyId, statement, "pdf", ctx.language);
        const bytes = typeof file.content === "string" ? new TextEncoder().encode(file.content) : new Uint8Array(file.content);
        await ctx.replyFile(
          { fileName: file.filename, contentType: file.contentType, bytes },
          card(ctx, [{ type: "text", text: ctx.t("documents.statementCaption", { from: ctx.fmt.date(`${year}-01-01`), to: ctx.fmt.date(today) }) }]),
        );
        await services.runtime?.auditBotAction(ctx, "bot.document.sent", "Party", party.id, { document: "customer_statement_pdf" });
      },
    },
  };
}
