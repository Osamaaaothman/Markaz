import { chromium, type Browser } from "playwright";

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

export async function renderHtmlToPdf(html: string, options: { landscape?: boolean } = {}): Promise<Buffer> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    // Templates embed approved assets. Never allow a document to fetch remote URLs.
    await page.route("**/*", (route) => route.request().url().startsWith("data:") ? route.continue() : route.abort());
    await page.emulateMedia({ media: "print" });
    await page.setContent(html, { waitUntil: "load" });
    await page.evaluate("document.fonts.ready");
    const footer = await page.evaluate<{ html: string; dir: string } | null>(`(() => {
      const element = document.querySelector(".report-footer-block");
      if (!element) return null;
      const result = { html: element.innerHTML, dir: document.documentElement.dir };
      element.remove();
      return result;
    })()`);
    if (footer) await page.addStyleTag({ content: "@page { margin-bottom: 32mm; }" });
    return await page.pdf({ format: "A4", printBackground: true, landscape: options.landscape ?? false,
      ...(footer ? { displayHeaderFooter: true, headerTemplate: "<span></span>",
        footerTemplate: `<style>.issued-by-block{display:flex;gap:28px;border-top:1px solid #ddd;padding-top:8px;margin-bottom:8px}.issued-by-block span{display:block}.issued-by-block strong{display:block;font-weight:400;color:#666;margin-bottom:3px}.computer-generated{text-align:center;margin:0;color:#666}bdi{unicode-bidi:isolate}</style><div dir="${footer.dir === "rtl" ? "rtl" : "ltr"}" style="font-family:'Noto Sans Arabic','Segoe UI',sans-serif;font-size:9px;color:#444;width:100%;padding:0 14mm;box-sizing:border-box">${footer.html}</div>`,
        margin: { bottom: "32mm" } } : {}),
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
