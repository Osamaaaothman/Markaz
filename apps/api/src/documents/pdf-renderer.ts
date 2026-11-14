import { chromium, type Browser } from "playwright";
import { escapeHtml } from "../common/html-escape.js";

// docs/14-MILESTONES.md M3: "Bilingual PDF rendering pipeline (server-side,
// RTL-correct)". HTML+CSS through a real browser engine is the only reliable way
// to get correct Arabic shaping and bidi — lower-level PDF libraries (pdfkit and
// similar) do not shape Arabic script correctly, and "RTL-correct" is a hard
// requirement here (Arabic is legally required on Saudi tax invoices,
// docs/00-PRODUCT-BRIEF.md). Reuses Playwright rather than adding a second
// headless-browser dependency, since docs/10-TESTING-RULES.md §1 already calls
// for Playwright for E2E.
let browserPromise: Promise<Browser> | null = null;

// One Chromium instance, launched once and reused across renders — launching a
// fresh browser per document would make every PDF job take seconds just to start.
async function getBrowser(): Promise<Browser> {
  browserPromise ??= chromium.launch({ headless: true });
  return browserPromise;
}

export async function renderHtmlToPdf(html: string, options: { landscape?: boolean; letterheadHtml?: string } = {}): Promise<Buffer> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    // Templates embed approved assets. Never allow a document to fetch remote URLs.
    await page.route("**/*", (route) => route.request().url().startsWith("data:") ? route.continue() : route.abort());
    await page.emulateMedia({ media: "print" });
    const brandedHtml = options.letterheadHtml
      ? html.replace(/<header class="company-head">[\s\S]*?<\/header>/, () => options.letterheadHtml!)
      : html;
    await page.setContent(brandedHtml, { waitUntil: "load" });
    await page.evaluate("Promise.all(Array.from(document.images, img => img.decode().catch(() => undefined)))");
    await page.evaluate("document.fonts.ready");
    const documentTitle = escapeHtml(await page.title());
    const footer = await page.evaluate<{ html: string; dir: string } | null>(`(() => {
      const element = document.querySelector(".report-footer-block");
      if (!element) return null;
      const result = { html: element.innerHTML, dir: document.documentElement.dir };
      element.remove();
      return result;
    })()`);
    await page.addStyleTag({ content: `@page { size: A4 ${options.landscape ? "landscape" : "portrait"}; margin-bottom: 26mm; }` });
    return await page.pdf({ format: "A4", printBackground: true, landscape: options.landscape ?? false,
      displayHeaderFooter: true, headerTemplate: "<span></span>",
      footerTemplate: `<style>.issued-by-block{display:flex;gap:28px;margin-bottom:6px}.issued-by-block span{display:block}.issued-by-block strong{display:block;font-weight:400;color:#64716c;margin-bottom:2px}.computer-generated{text-align:center;margin:0;color:#64716c}bdi{unicode-bidi:isolate}</style><div dir="${footer?.dir === "rtl" ? "rtl" : "ltr"}" style="font-family:'Noto Sans Arabic','Segoe UI',sans-serif;font-size:9px;color:#444;width:100%;padding:0 14mm;box-sizing:border-box"><div style="border-top:1px solid #cdd7d2;padding-top:7px">${footer?.html ?? ""}<div style="display:flex;justify-content:space-between;gap:20px;margin-top:5px;color:#64716c"><span>${documentTitle}</span><span dir="ltr"><span class="pageNumber"></span> / <span class="totalPages"></span></span></div></div></div>`,
      margin: { bottom: "26mm" },
    });
  } finally {
    await page.close();
  }
}

// Worker shutdown (apps/api/src/worker.ts) calls this so the process can exit
// cleanly — an open browser process is exactly the kind of handle that otherwise
// keeps Node alive after SIGTERM.
export async function closePdfRenderer(): Promise<void> {
  if (browserPromise !== null) {
    const browser = await browserPromise;
    await browser.close();
    browserPromise = null;
  }
}
