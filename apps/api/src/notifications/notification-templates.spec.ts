import { renderGenericNotice } from "./notification-templates.js";

describe("renderGenericNotice", () => {
  it("renders English left-to-right with the correct interpolated values", async () => {
    const email = await renderGenericNotice({
      language: "en",
      to: "user@example.com",
      recipientName: "Sara",
      companyName: "Markaz",
      message: "Your invoice is ready.",
    });

    expect(email.to).toBe("user@example.com");
    expect(email.subject).toBe("Notice from Markaz");
    expect(email.html).toContain('dir="ltr"');
    expect(email.html).toContain('lang="en"');
    expect(email.html).toContain("Hello Sara,");
    expect(email.html).toContain("Your invoice is ready.");
    expect(email.text).toContain("Hello Sara,");
  });

  it("renders Arabic right-to-left, not just translated text with the wrong direction", async () => {
    const email = await renderGenericNotice({
      language: "ar",
      to: "user@example.com",
      recipientName: "سارة",
      companyName: "مركز",
      message: "فاتورتك جاهزة.",
    });

    expect(email.subject).toBe("إشعار من مركز");
    expect(email.html).toContain('dir="rtl"');
    expect(email.html).toContain('lang="ar"');
    expect(email.html).toContain("مرحباً سارة،");
  });

  it("HTML-escapes interpolated values so a caller-supplied string can't inject markup", async () => {
    const email = await renderGenericNotice({
      language: "en",
      to: "user@example.com",
      recipientName: '<script>alert("x")</script>',
      companyName: "Markaz",
      message: "hi",
    });

    expect(email.html).not.toContain("<script>alert");
    expect(email.html).toContain("&lt;script&gt;");
  });

  it("renders both languages concurrently without cross-contaminating (getFixedT, not a shared current-language)", async () => {
    const [en, ar] = await Promise.all([
      renderGenericNotice({
        language: "en",
        to: "a@example.com",
        recipientName: "A",
        companyName: "Markaz",
        message: "m",
      }),
      renderGenericNotice({
        language: "ar",
        to: "b@example.com",
        recipientName: "ب",
        companyName: "مركز",
        message: "م",
      }),
    ]);

    expect(en.subject).toBe("Notice from Markaz");
    expect(ar.subject).toBe("إشعار من مركز");
  });
});
