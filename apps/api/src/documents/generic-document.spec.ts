import { renderGenericDocument } from "./generic-document-template.js";
import { renderHtmlToPdf, closePdfRenderer } from "./pdf-renderer.js";

// docs/14-MILESTONES.md M3 gate: "a PDF renders correctly in Arabic RTL and
// English LTR." Automated coverage proves the pipeline genuinely produces a valid
// PDF for both languages; the actual visual RTL shaping was additionally verified
// by hand by rendering both and inspecting them (not automatable without a
// snapshot-testing setup, which is not justified for one demo template).
describe("PDF rendering pipeline", () => {
  afterAll(async () => {
    await closePdfRenderer();
  });

  it.each(["en", "ar"] as const)("renders a valid PDF for language=%s", async (language) => {
    const html = await renderGenericDocument({
      language,
      recipientName: language === "ar" ? "أسامة" : "Osama",
      companyName: language === "ar" ? "مركز" : "Markaz",
      message: language === "ar" ? "فاتورتك جاهزة." : "Your invoice is ready.",
    });

    expect(html).toContain(`dir="${language === "ar" ? "rtl" : "ltr"}"`);

    const pdf = await renderHtmlToPdf(html);
    expect(pdf.subarray(0, 4).toString("latin1")).toBe("%PDF");
    // A trivially small buffer would mean rendering silently failed/produced a
    // blank page rather than actually erroring — this is a real, if cheap, floor.
    expect(pdf.length).toBeGreaterThan(1000);
  }, 30_000);
});
