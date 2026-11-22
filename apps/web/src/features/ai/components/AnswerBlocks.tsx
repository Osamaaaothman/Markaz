import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { formatMoney, groupThousands } from "../../../shared/lib/money";
import { formatCalendarDate } from "../../../shared/lib/format-date";
import { MonthlyChart } from "../../dashboard/MonthlyChart";
import type { DisplayBlock } from "../ai-api";

function cell(value: string | undefined, format: string | undefined, currency: string, locale: string): string {
  if (value === undefined || value === "") return "—";
  if (format === "money") return /^-?\d+(\.\d+)?$/.test(value) ? formatMoney(value, currency) : value;
  if (format === "number") return /^-?\d+(\.\d+)?$/.test(value) ? groupThousands(value) : value;
  if (format === "date") return /^\d{4}-\d{2}-\d{2}/.test(value) ? formatCalendarDate(value.slice(0, 10), locale) : value;
  return value;
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
                <h4 className="ai-block__title">{t(b.titleKey)}</h4>
                <div className="ai-kpis">
                  {b.items.map((k) => (
                    <div key={k.labelKey} className="ai-kpi">
                      <span className="ai-kpi__label">{t(k.labelKey)}</span>
                      <span className="ai-kpi__value" dir="ltr">{cell(k.value, k.format, k.currency ?? currency, lang)}</span>
                    </div>
                  ))}
                </div>
              </section>
            );
          case "table":
            if (b.rows.length === 0) return <p key={i} className="ai-block__empty">{t("ai.blocks.empty")}</p>;
            return (
              <section key={i} className="ai-block">
                <div className="ai-block__head">
                  <h4 className="ai-block__title">{t(b.titleKey)}</h4>
                  {b.link ? <Link className="ai-block__open" to={b.link}>{t("ai.blocks.open")} <i className="pi pi-arrow-up-right" aria-hidden="true" /></Link> : null}
                </div>
                <div className="ai-table-wrap">
                  <table className="ai-table">
                    <thead><tr>{b.columns.map((c) => <th key={c.key}>{t(c.labelKey)}</th>)}</tr></thead>
                    <tbody>
                      {b.rows.map((r, ri) => (
                        <tr key={ri}>
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
              <section key={i} className="ai-block">
                <h4 className="ai-block__title">{t(b.titleKey)}</h4>
                <MonthlyChart months={months} currency={currency} />
              </section>
            );
          }
          case "links":
            return (
              <section key={i} className="ai-block">
                <h4 className="ai-block__title">{t(b.titleKey)}</h4>
                <div className="ai-links">{b.items.map((l) => <Link key={l.path + l.label} className="ai-chip" to={l.path}>{l.label}</Link>)}</div>
              </section>
            );
          case "clarify":
            return (
              <section key={i} className="ai-block ai-block--clarify">
                <p className="ai-clarify__q"><i className="pi pi-question-circle" aria-hidden="true" /> {b.question}</p>
                <div className="ai-links">
                  {b.options.map((o) => (
                    <button key={o} type="button" className="ai-chip ai-chip--choice" disabled={disabled} onClick={() => onChoose(o)}>{o}</button>
                  ))}
                </div>
              </section>
            );
        }
      })}
    </div>
  );
}
