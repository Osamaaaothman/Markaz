import { useTranslation } from "react-i18next";
import { formatMoney } from "../../shared/lib/money";
import type { MonthlyResult } from "./use-dashboard";

const WIDTH = 520;
const HEIGHT = 180;
const PAD_TOP = 12;
const PAD_BOTTOM = 26;

// Revenue and expense for the last months as paired bars — plain SVG, no chart library. Bars grow from
// the baseline in proportion to the largest value shown; a month with nothing is a hairline, not a gap.
// Direction-neutral: the SVG itself is drawn left to right in both languages, which is how charts read
// even in Arabic; the surrounding text follows the page direction.
export function MonthlyChart({ months, currency }: { months: readonly MonthlyResult[]; currency: string }): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const values = months.flatMap((m) => [Math.max(Number(m.revenue), 0), Math.max(Number(m.expense), 0)]);
  const max = Math.max(...values, 1);
  const plotHeight = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const slot = WIDTH / Math.max(months.length, 1);
  const barWidth = Math.min(26, slot / 3);
  const height = (v: number): number => Math.max((Math.max(v, 0) / max) * plotHeight, v > 0 ? 2 : 1);
  const monthLabel = (month: string): string =>
    new Intl.DateTimeFormat(i18n.language, { month: "short", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`));

  return (
    <figure className="erp-chart">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={t("dashboard.chart.aria")} className="erp-chart__svg" direction="ltr">
        <line x1={0} y1={HEIGHT - PAD_BOTTOM} x2={WIDTH} y2={HEIGHT - PAD_BOTTOM} className="erp-chart__axis" />
        {months.map((m, i) => {
          const x = i * slot + slot / 2;
          const rev = Number(m.revenue);
          const exp = Number(m.expense);
          return (
            <g key={m.month}>
              <rect x={x - barWidth - 2} y={HEIGHT - PAD_BOTTOM - height(rev)} width={barWidth} height={height(rev)} rx={3} className="erp-chart__bar erp-chart__bar--revenue">
                <title>{`${monthLabel(m.month)} · ${t("dashboard.chart.revenue")}: ${formatMoney(m.revenue, currency)}`}</title>
              </rect>
              <rect x={x + 2} y={HEIGHT - PAD_BOTTOM - height(exp)} width={barWidth} height={height(exp)} rx={3} className="erp-chart__bar erp-chart__bar--expense">
                <title>{`${monthLabel(m.month)} · ${t("dashboard.chart.expense")}: ${formatMoney(m.expense, currency)}`}</title>
              </rect>
              <text x={x} y={HEIGHT - 8} textAnchor="middle" className="erp-chart__label">
                {monthLabel(m.month)}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption className="erp-chart__legend">
        <span className="erp-chart__key erp-chart__key--revenue">{t("dashboard.chart.revenue")}</span>
        <span className="erp-chart__key erp-chart__key--expense">{t("dashboard.chart.expense")}</span>
      </figcaption>
    </figure>
  );
}
