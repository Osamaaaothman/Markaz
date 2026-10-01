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

export async function renderHtmlToPdf(html: string): Promise<Buffer> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: "load" });
    return await page.pdf({ format: "A4", printBackground: true });
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
