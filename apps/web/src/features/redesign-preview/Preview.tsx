import { useEffect, useMemo, useRef, useState } from "react";
import { PrimeReactProvider, addLocale, locale } from "primereact/api";
import { InputTextarea } from "primereact/inputtextarea";
import { Toast } from "primereact/toast";
import { ChoiceSelect } from "../../shared/ui/ChoiceSelect";
import { DIALOGS, SECTIONS, STYLES, type Invoice, type StyleId } from "./catalog";
import { PreviewContext, B, Icon, Panel, Section, downloadText, translate } from "./ui";
import {
  AccountingSection,
  ActionsSection,
  DashboardSection,
  DocumentsSection,
  FieldsSection,
  TablesSection,
} from "./WorkSections";
import {
  FeedbackSection,
  FilesSection,
  FoundationsSection,
  NavigationSection,
} from "./ExperienceSections";
import { DialogGallery, PreviewDialog } from "./DialogGallery";

addLocale("ar", {
  firstDayOfWeek: 0,
  prevMonth: "الشهر السابق",
  nextMonth: "الشهر التالي",
  prevYear: "السنة السابقة",
  nextYear: "السنة التالية",
  chooseDate: "اختيار التاريخ",
  chooseMonth: "اختيار الشهر",
  chooseYear: "اختيار السنة",
  dayNames: ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"],
  dayNamesShort: ["أحد", "إثنين", "ثلاثاء", "أربعاء", "خميس", "جمعة", "سبت"],
  dayNamesMin: ["ح", "ن", "ث", "ر", "خ", "ج", "س"],
  monthNames: [
    "يناير",
    "فبراير",
    "مارس",
    "أبريل",
    "مايو",
    "يونيو",
    "يوليو",
    "أغسطس",
    "سبتمبر",
    "أكتوبر",
    "نوفمبر",
    "ديسمبر",
  ],
  monthNamesShort: [
    "يناير",
    "فبراير",
    "مارس",
    "أبريل",
    "مايو",
    "يونيو",
    "يوليو",
    "أغسطس",
    "سبتمبر",
    "أكتوبر",
    "نوفمبر",
    "ديسمبر",
  ],
  today: "اليوم",
  clear: "مسح",
  emptyMessage: "لا توجد بيانات",
  emptyFilterMessage: "لا توجد نتائج",
  choose: "اختيار",
  upload: "رفع",
  cancel: "إلغاء",
  aria: {
    close: "إغلاق",
    nextPageLabel: "الصفحة التالية",
    prevPageLabel: "الصفحة السابقة",
    firstPageLabel: "الصفحة الأولى",
    lastPageLabel: "الصفحة الأخيرة",
    pageLabel: "الصفحة {page}",
    selectRow: "تحديد الصف",
    unselectRow: "إلغاء تحديد الصف",
    selectAll: "تحديد الكل",
    unselectAll: "إلغاء تحديد الكل",
  },
});
const STORAGE = "markaz-redesign-review-v1";
interface Review {
  style: StyleId;
  notes: string;
}
function readReview(): Review | null {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(STORAGE) ?? "null");
    if (
      data &&
      typeof data === "object" &&
      "style" in data &&
      STYLES.includes(data.style as StyleId) &&
      "notes" in data &&
      typeof data.notes === "string"
    )
      return { style: data.style as StyleId, notes: data.notes };
  } catch {
    /* Storage is optional. */
  }
  return null;
}
function MiniWorkspace({ style }: { style: StyleId }): React.JSX.Element {
  return (
    <div className={`rd-mini rd-mini-${style}`} aria-hidden="true">
      <div className="rd-mini-nav">
        <i />
        <i />
        <i />
        <i />
      </div>
      <div className="rd-mini-main">
        <div className="rd-mini-top">
          <i />
          <b />
        </div>
        <div className="rd-mini-kpis">
          <i />
          <i />
          <i />
        </div>
        <div className="rd-mini-table">
          <span />
          <span />
          <span />
        </div>
      </div>
    </div>
  );
}
export function Preview(): React.JSX.Element {
  const [initialReview] = useState(readReview);
  const [style, setStyle] = useState<StyleId>(() => {
    const query = new URLSearchParams(location.search).get("style");
    return STYLES.includes(query as StyleId)
      ? (query as StyleId)
      : (initialReview?.style ?? "balance");
  });
  const [lang, setLang] = useState<"ar" | "en">("ar");
  const [mode, setMode] = useState("light");
  const [compact, setCompact] = useState(false);
  const [motion, setMotion] = useState(true);
  const [systemReduced, setSystemReduced] = useState(
    () => matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [mobileOpen, setMobileOpen] = useState(false);
  const [active, setActive] = useState("overview");
  const [dialog, setDialog] = useState<string | null>(null);
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [chosen, setChosen] = useState<StyleId | null>(initialReview?.style ?? null);
  const [notes, setNotes] = useState(initialReview?.notes ?? "");
  const toast = useRef<Toast>(null);
  const t = (key: string) => translate(lang, key);
  const effectiveMotion = motion && !systemReduced;
  function notify(
    message = t("sampleSaved"),
    severity: "success" | "info" | "warn" | "error" = "success",
  ): void {
    toast.current?.show({ severity, summary: message, life: 3500 });
  }
  const open = (id: string, record?: Invoice) => {
    setInvoice(record ?? null);
    setDialog(id);
  };
  useEffect(() => {
    locale(lang);
    const html = document.documentElement;
    html.dataset.previewStyle = style;
    html.dataset.previewMode = mode;
    html.dataset.previewDensity = compact ? "compact" : "comfortable";
    html.dataset.previewMotion = effectiveMotion ? "on" : "off";
    html.dir = lang === "ar" ? "rtl" : "ltr";
    html.lang = lang;
    document.title = lang === "ar" ? "مركز — مختبر التصميم" : "Markaz — Design explorer";
  }, [style, mode, lang, compact, effectiveMotion]);
  useEffect(() => {
    const query = matchMedia("(prefers-reduced-motion: reduce)");
    const changed = () => setSystemReduced(query.matches);
    query.addEventListener("change", changed);
    return () => query.removeEventListener("change", changed);
  }, []);
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setDialog((current) => (current === "command" ? null : "command"));
      }
      if (e.key === "Escape") setMobileOpen(false);
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, []);
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries.find((v) => v.isIntersecting);
        if (entry) setActive(entry.target.id);
      },
      { rootMargin: "-90px 0px -65% 0px", threshold: 0 },
    );
    document.querySelectorAll("main > section").forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, []);
  const context = useMemo(
    () => ({
      lang,
      style,
      motion: effectiveMotion,
      t: (key: string) => translate(lang, key),
      open,
      notify,
      selectStyle,
    }),
    [lang, style, effectiveMotion],
  );
  const spec = DIALOGS.find((item) => item.id === dialog);
  function selectStyle(value: StyleId): void {
    setStyle(value);
    const url = new URL(location.href);
    url.searchParams.set("style", value);
    history.replaceState(null, "", url);
  }
  function saveChoice(): void {
    setChosen(style);
    try {
      localStorage.setItem(STORAGE, JSON.stringify({ style, notes }));
      notify(t("savedPreference"));
    } catch {
      notify(t("storageUnavailable"), "info");
    }
  }
  return (
    <PrimeReactProvider value={{ ripple: false, locale: lang, cssTransition: effectiveMotion }}>
      <PreviewContext.Provider value={context}>
        <a href="#overview" className="rd-skip">
          {t("overview")}
        </a>
        <div className={`rd-app ${mobileOpen ? "rd-nav-open" : ""}`}>
          <aside className="rd-sidebar" id="rd-navigation">
            <a
              className="rd-brand"
              aria-label={t("brand")}
              href="#overview"
              onClick={() => setMobileOpen(false)}
            >
              <span className="rd-brand-mark">
                <i />
                <b />
              </span>
              <span>
                <strong>{t("brand")}</strong>
                <small>MARKAZ</small>
              </span>
              <span className="rd-brand-edition">/ 02</span>
            </a>
            <div className="rd-sidebar-label">{t("lab")}</div>
            <button type="button" className="rd-nav-search" onClick={() => open("command")}>
              <Icon name="search" />
              <span>{t("search")}</span>
              <kbd>⌘ K</kbd>
            </button>
            <nav aria-label={t("lab")}>
              {SECTIONS.map(([id, icon], index) => (
                <a
                  href={`#${id}`}
                  key={id}
                  className={active === id ? "is-active" : ""}
                  aria-current={active === id ? "location" : undefined}
                  title={t(id)}
                  onClick={() => {
                    setActive(id);
                    setMobileOpen(false);
                  }}
                >
                  <Icon name={icon} />
                  <span>{t(id)}</span>
                  <small>{String(index + 1).padStart(2, "0")}</small>
                </a>
              ))}
            </nav>
            <div className="rd-sidebar-foot">
              <span className="rd-avatar">م</span>
              <div>
                <strong>{t("workspace")}</strong>
                <small>{t("preview")}</small>
              </div>
              <span className="rd-live-dot" />
            </div>
          </aside>
          <div className="rd-main-shell">
            <header className="rd-topbar">
              <div className="rd-topbar-start">
                <B
                  icon="pi pi-bars"
                  text
                  className="rd-mobile-toggle"
                  aria-label={t("menu")}
                  aria-expanded={mobileOpen}
                  aria-controls="rd-navigation"
                  onClick={() => setMobileOpen((v) => !v)}
                />
                <span className="rd-topbar-breadcrumb">
                  {t("brand")}
                  <span>/</span>
                  <strong>{t("lab")}</strong>
                </span>
                <ChoiceSelect<StyleId>
                  className="rd-style-select"
                  label={t("directions")}
                  value={style}
                  onChange={selectStyle}
                  options={STYLES.map((value) => ({ value, label: t(value) }))}
                />
                <span className="rd-demo-chip">
                  <i />
                  {t("demo")}
                </span>
              </div>
              <div className="rd-topbar-tools">
                <B
                  label={t("language")}
                  text
                  onClick={() => setLang((v) => (v === "ar" ? "en" : "ar"))}
                />
                <B
                  icon={`pi pi-${mode === "light" ? "moon" : "sun"}`}
                  text
                  aria-label={t(mode === "light" ? "dark" : "light")}
                  title={t(mode === "light" ? "dark" : "light")}
                  onClick={() => setMode((v) => (v === "light" ? "dark" : "light"))}
                />
                <B
                  icon="pi pi-align-justify"
                  text
                  aria-label={t(compact ? "comfortable" : "compact")}
                  aria-pressed={compact}
                  title={t(compact ? "comfortable" : "compact")}
                  onClick={() => setCompact((v) => !v)}
                />
                <B
                  icon={`pi pi-${effectiveMotion ? "bolt" : "pause"}`}
                  text
                  aria-label={t(effectiveMotion ? "noMotion" : "motion")}
                  aria-pressed={effectiveMotion}
                  title={t(effectiveMotion ? "noMotion" : "motion")}
                  onClick={() => setMotion((v) => !v)}
                />
                <span className="rd-topbar-divider" />
                <button
                  type="button"
                  className="rd-topbar-search"
                  onClick={() => open("command")}
                  aria-label={t("search")}
                >
                  <Icon name="search" />
                  <kbd>Ctrl K</kbd>
                </button>
              </div>
            </header>
            <main className="rd-main">
              <section id="overview" aria-labelledby="overview-title" className="rd-intro">
                <div className="rd-intro-heading">
                  <div>
                    <p className="rd-overline">{t("eyebrow")}</p>
                    <h1 id="overview-title">{t("title")}</h1>
                    <p className="rd-intro-copy">{t("intro")}</p>
                  </div>
                  <div className="rd-edition-stamp">
                    <span>03</span>
                    <div>
                      {t("directions")}
                      <small>{t("liveComponents")}</small>
                    </div>
                  </div>
                </div>
                <div className="rd-style-grid" role="group" aria-label={t("directions")}>
                  {STYLES.map((value, i) => (
                    <button
                      type="button"
                      key={value}
                      className={`rd-style-option ${value === style ? "is-selected" : ""}`}
                      data-style-option={value}
                      aria-pressed={value === style}
                      onClick={() => selectStyle(value)}
                    >
                      <div className="rd-style-top">
                        <span className="rd-style-number">0{i + 1}</span>
                        <span>
                          {value === "balance"
                            ? t("recommended")
                            : value === style
                              ? t("selected")
                              : ""}
                        </span>
                        <i className={`pi pi-${value === style ? "check-circle" : "circle"}`} />
                      </div>
                      <MiniWorkspace style={value} />
                      <div className="rd-style-info">
                        <strong>
                          {t(value)}
                          <small>{["BALANCE", "CANVAS", "PRECISION"][i]}</small>
                        </strong>
                        <p>{t(`${value}Desc`)}</p>
                        <small>{t(`${value}Shape`)}</small>
                      </div>
                    </button>
                  ))}
                </div>
                <div className="rd-intro-foot">
                  <span>
                    <Icon name="sliders-h" />
                    {t("liveComponents")}
                  </span>
                  <span>
                    <b>{DIALOGS.length}</b> {t("dialogCount")}
                  </span>
                  <span>
                    <b>{SECTIONS.length - 1}</b> {t("sections")}
                  </span>
                  <a href="#recommendation">
                    {t("recommendation")} <Icon name="arrow-up-left" />
                  </a>
                </div>
              </section>
              <DashboardSection />
              <ActionsSection />
              <FieldsSection />
              <TablesSection />
              <DocumentsSection />
              <AccountingSection />
              <NavigationSection />
              <DialogGallery />
              <FeedbackSection />
              <FilesSection />
              <FoundationsSection />
              <Section id="recommendation">
                <div className="rd-recommend-grid">
                  <Panel className="rd-recommendation">
                    <span className="rd-recommend-icon">
                      <Icon name="compass" />
                    </span>
                    <span className="rd-overline">{t("recommendBalance")}</span>
                    <h3>{t("systemTitle")}</h3>
                    <p>{t("systemBody")}</p>
                    <p>{t("recommendReason")}</p>
                    <ul>
                      {[1, 2, 3, 4].map((i) => (
                        <li key={i}>
                          <Icon name="check" />
                          {t(`criterion${i}`)}
                        </li>
                      ))}
                    </ul>
                    <div className="rd-source-links">
                      <a
                        href="https://v10.primereact.org/theming/"
                        target="_blank"
                        rel="noreferrer"
                      >
                        {t("sourcePrime")} ↗
                      </a>
                      <a
                        href="https://www.carbondesignsystem.com/building-blocks/core/components/data-table/guidelines"
                        target="_blank"
                        rel="noreferrer"
                      >
                        {t("sourceCarbon")} ↗
                      </a>
                      <a
                        href="https://www.carbondesignsystem.com/building-blocks/foundations/motion/overview"
                        target="_blank"
                        rel="noreferrer"
                      >
                        {t("sourceMotion")} ↗
                      </a>
                    </div>
                  </Panel>
                  <Panel className="rd-choice">
                    <h3>{t("yourChoice")}</h3>
                    <p>{t("choiceHint")}</p>
                    <div className="rd-choice-styles">
                      {STYLES.map((value) => (
                        <button
                          type="button"
                          key={value}
                          aria-pressed={style === value}
                          onClick={() => selectStyle(value)}
                        >
                          <span className={`rd-choice-dot rd-choice-${value}`} />
                          {t(value)}
                          {chosen === value ? (
                            <Icon name="bookmark-fill" />
                          ) : style === value ? (
                            <Icon name="check" />
                          ) : null}
                        </button>
                      ))}
                    </div>
                    <div className="rd-field">
                      <label htmlFor="review-notes">{t("reviewNotes")}</label>
                      <InputTextarea
                        id="review-notes"
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        rows={4}
                        placeholder={t("reviewPlaceholder")}
                      />
                    </div>
                    <B label={t("choose")} icon="pi pi-bookmark" onClick={saveChoice} />
                    <B
                      label={t("exportChoice")}
                      text
                      icon="pi pi-download"
                      onClick={() =>
                        downloadText(
                          "markaz-design-feedback.json",
                          JSON.stringify(
                            {
                              selectedStyle: style,
                              savedPreference: chosen,
                              notes,
                              mode,
                              density: compact ? "compact" : "comfortable",
                              language: lang,
                              motion: effectiveMotion,
                              generatedAt: new Date().toISOString(),
                            },
                            null,
                            2,
                          ),
                          "application/json",
                        )
                      }
                    />
                    {chosen ? (
                      <div className="rd-saved-choice" role="status">
                        <Icon name="check-circle" />
                        {t("chosen")}: {t(chosen)}
                      </div>
                    ) : null}
                  </Panel>
                </div>
              </Section>
              <footer className="rd-footer">
                <span>{t("footer")}</span>
                <span>{t("localOnly")}</span>
                <a href="#overview">↑ {t("overview")}</a>
              </footer>
            </main>
          </div>
        </div>
        <Toast ref={toast} position={lang === "ar" ? "bottom-left" : "bottom-right"} />
        {spec ? (
          <PreviewDialog
            key={spec.id}
            spec={spec}
            invoice={invoice}
            onHide={() => setDialog(null)}
          />
        ) : null}
      </PreviewContext.Provider>
    </PrimeReactProvider>
  );
}
