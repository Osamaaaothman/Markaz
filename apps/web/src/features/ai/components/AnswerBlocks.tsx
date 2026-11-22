import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { formatCalendarDate } from "../../../shared/lib/format-date";
import { formatMoney, groupThousands } from "../../../shared/lib/money";
import { useCountUp } from "../../../shared/lib/use-count-up";
import { exportReport } from "../../accounting/export-report";
import { MonthlyChart } from "../../dashboard/MonthlyChart";
import type { DisplayBlock } from "../ai-api";

const DECIMAL = /^-?\d+(\.\d+)?$/;

function cell(value: string | undefined, format: string | undefined, currency: string, locale: string): string {
  if (value === undefined || value === "") return "—";
  if (format === "money") return DECIMAL.test(value) ? formatMoney(value, currency) : value;
  if (format === "number") return DECIMAL.test(value) ? groupThousands(value) : value;
  if (format === "date") return /^\d{4}-\d{2}-\d{2}/.test(value) ? formatCalendarDate(value.slice(0, 10), locale) : value;
  return value;
}

const KPI_ICON: Record<string, string> = {
  "ai.kpi.salesThisMonth": "pi pi-shopping-bag",
  "ai.kpi.receivables": "pi pi-arrow-down-left",
  "ai.kpi.overdueReceivables": "pi pi-clock",
  "ai.kpi.payables": "pi pi-arrow-up-right",
  "ai.kpi.cash": "pi pi-wallet",
  "ai.kpi.stockValue": "pi pi-box",
  "ai.kpi.belowReorder": "pi pi-exclamation-triangle",
  "ai.kpi.pendingApprovals": "pi pi-inbox",
};

// The figure counts up when it appears. Only the animation frames are approximate: the final frame is
// always the exact decimal string from the server, formatted by the shared money helpers.
function KpiValue({ value, format, currency }: { value: string; format: string; currency: string }): React.JSX.Element {
  const progress = useCountUp(value, 900, 80);
  if (progress >= 1 || !DECIMAL.test(value)) return <>{cell(value, format, currency, "en")}</>;
  const partial = (Number(value) * progress).toFixed(format === "money" ? 2 : 0);
  return <>{format === "money" ? formatMoney(partial, currency) : groupThousands(partial)}</>;
}

// Structured parts of an answer. The model never writes HTML: tools hand these blocks over and the
// screen draws them with the same formatting rules as the rest of the app.
export function AnswerBlocks({ blocks, currency, onChoose, disabled }: { blocks: DisplayBlock[]; currency: string; onChoose: (text: string) => void; disabled: boolean }): React.JSX.Element | null {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  if (blocks.length === 0) return null;
  return (
    <div className="ai-blocks">
      {blocks.map((b, i) => {
        switch (b.kind) {
          case "kpis":
            return (
              <section key={i} className="ai-block ai-block--kpis">
                <h4 className="ai-block__title"><i className="pi pi-chart-pie" aria-hidden="true" /> {t(b.titleKey)}</h4>
                <div className="ai-kpis">
                  {b.items.map((k, ki) => (
                    <div key={k.labelKey} className={`ai-kpi${k.labelKey.includes("overdue") || k.labelKey.includes("belowReorder") ? " ai-kpi--alert" : ""}`} style={{ animationDelay: `${ki * 60}ms` }}>
                      <span className="ai-kpi__icon"><i className={KPI_ICON[k.labelKey] ?? "pi pi-chart-bar"} aria-hidden="true" /></span>
                      <span className="ai-kpi__label">{t(k.labelKey)}</span>
                      <span className="ai-kpi__value" dir="ltr">{k.format === "text" ? k.value : <KpiValue value={k.value} format={k.format} currency={k.currency ?? currency} />}</span>
                    </div>
                  ))}
                </div>
              </section>
            );
          case "table":
            if (b.rows.length === 0) return <p key={i} className="ai-block__empty"><i className="pi pi-search" aria-hidden="true" /> {t("ai.blocks.empty")}</p>;
            return (
              <section key={i} className="ai-block">
                <div className="ai-block__head">
                  <h4 className="ai-block__title"><i className="pi pi-table" aria-hidden="true" /> {t(b.titleKey)} <span className="ai-block__count">{b.rows.length}</span></h4>
                  {b.link ? <Link className="ai-block__open" to={b.link}>{t("ai.blocks.open")} <i className="pi pi-arrow-up-right" aria-hidden="true" /></Link> : null}
                </div>
                <div className="ai-table-wrap">
                  <table className="ai-table">
                    <thead><tr>{b.columns.map((c) => <th key={c.key}>{t(c.labelKey)}</th>)}</tr></thead>
                    <tbody>
                      {b.rows.map((r, ri) => (
                        <tr key={ri} style={{ animationDelay: `${ri * 35}ms` }}>
                          {b.columns.map((c, ci) => (
                            <td key={c.key} className={c.format === "money" || c.format === "number" ? "ai-table__num" : undefined}>
                              {ci === 0 && r["_link"] ? <Link to={r["_link"]}>{cell(r[c.key], c.format, currency, lang)}</Link> : cell(r[c.key], c.format, currency, lang)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          case "chart": {
            const [revenue, expense] = b.series;
            const months = b.labels.map((month, mi) => ({ month, revenue: revenue?.values[mi] ?? "0", expense: expense?.values[mi] ?? "0" }));
            return (
              <section key={i} className="ai-block ai-block--chart">
                <h4 className="ai-block__title"><i className="pi pi-chart-bar" aria-hidden="true" /> {t(b.titleKey)}</h4>
                <MonthlyChart months={months} currency={currency} />
              </section>
            );
          }
          case "links":
            return (
              <section key={i} className="ai-block">
                <h4 className="ai-block__title">{t(b.titleKey)}</h4>
                <div className="ai-links">{b.items.map((l) => <Link key={l.path + l.label} className="ai-suggestion" to={l.path}>{l.label}</Link>)}</div>
              </section>
            );
          case "file":
            return (
              <section key={i} className="ai-block ai-file">
                <div className="ai-file__icon" aria-hidden="true"><i className="pi pi-file-pdf" /><span>PDF</span></div>
                <div className="ai-file__body">
                  <span className="ai-file__kind">{t(b.titleKey)}</span>
                  <strong className="ai-file__name">{b.label}</strong>
                  {b.meta?.length ? (
                    <dl className="ai-file__meta">
                      {b.meta.map((m) => (
                        <div key={m.labelKey}>
                          <dt>{t(m.labelKey)}</dt>
                          <dd dir={m.format === "money" ? "ltr" : undefined}>{cell(m.value, m.format, b.currency ?? currency, lang)}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}
                  <div className="ai-file__actions">
                    <button type="button" className="ai-btn ai-btn--primary" onClick={() => void exportReport(b.apiPath, { lang }, b.filename, "pdf")}>
                      <i className="pi pi-download" aria-hidden="true" /> {t("ai.file.download")}
                    </button>
                    <button type="button" className="ai-btn ai-btn--ghost" onClick={() => void exportReport(b.apiPath, { lang }, b.filename, "print")}>
                      <i className="pi pi-print" aria-hidden="true" /> {t("ai.file.print")}
                    </button>
                    {b.openPath ? (
                      <Link className="ai-btn ai-btn--ghost" to={b.openPath}><i className="pi pi-external-link" aria-hidden="true" /> {t("ai.file.open")}</Link>
                    ) : null}
                  </div>
                </div>
              </section>
            );
          case "clarify":
            return (
              <section key={i} className="ai-block ai-block--clarify">
                <p className="ai-clarify__q"><span className="ai-clarify__icon"><i className="pi pi-question" aria-hidden="true" /></span>{b.question}</p>
                <div className="ai-choices">
                  {b.options.map((o, oi) => (
                    <button key={o} type="button" className="ai-choice" style={{ animationDelay: `${oi * 60}ms` }} disabled={disabled} onClick={() => onChoose(o)}>
                      <span className="ai-choice__n">{oi + 1}</span>
                      <span>{o}</span>
                      <i className="pi pi-arrow-right ai-choice__go" aria-hidden="true" />
                    </button>
                  ))}
                </div>
              </section>
            );
        }
      })}
    </div>
  );
}
