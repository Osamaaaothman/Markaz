import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Money } from "@erp/shared";
import { formatMoney } from "../../shared/lib/money";
import type { MonthlyResult } from "./use-dashboard";

const W = 580;
const H = 250;
const PAD = { top: 16, right: 12, bottom: 30, left: 46 };
const PLOT_H = H - PAD.top - PAD.bottom;
const PLOT_W = W - PAD.left - PAD.right;

// Round the top of the scale up to 1, 2, 2.5, 5 or 10 times a power of ten, so the grid lines land on
// readable numbers (4 800 -> 5 000, not 4 800).
function niceMax(value: number): number {
  if (value <= 0) return 1;
  const exponent = Math.pow(10, Math.floor(Math.log10(value)));
  const fraction = value / exponent;
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10;
  return nice * exponent;
}

function compact(value: number): string {
  if (value >= 1_000_000) return `${+(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${+(value / 1_000).toFixed(1)}k`;
  return String(value);
}

// Revenue and expense for each month as paired bars that grow from the baseline, with a net-result line
// drawn over them and a tooltip per month. Plain SVG, no chart library. The SVG itself is drawn left to
// right in both languages (charts read that way even in Arabic); the labels around it follow the page.
export function MonthlyChart({ months, currency }: { months: readonly MonthlyResult[]; currency: string }): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const [hover, setHover] = useState<number | null>(null);

  const revenue = months.map((m) => Math.max(Number(m.revenue), 0));
  const expense = months.map((m) => Math.max(Number(m.expense), 0));
  const net = months.map((m) => Number(m.revenue) - Number(m.expense));
  const top = niceMax(Math.max(...revenue, ...expense, 1));
  const y = (value: number): number => PAD.top + PLOT_H - (Math.min(Math.max(value, 0), top) / top) * PLOT_H;
  const slot = PLOT_W / Math.max(months.length, 1);
  const barW = Math.min(24, slot / 3.2);
  const centerX = (i: number): number => PAD.left + i * slot + slot / 2;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * top);
  const monthLabel = (month: string): string => new Intl.DateTimeFormat(i18n.language, { month: "short", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`));

  // a bar with only its top corners rounded
  const bar = (x: number, value: number): string => {
    const h = Math.max(PAD.top + PLOT_H - y(value), value > 0 ? 2 : 0);
    const r = Math.min(5, h / 2, barW / 2);
    const y0 = PAD.top + PLOT_H - h;
    return `M${x},${y0 + h} V${y0 + r} Q${x},${y0} ${x + r},${y0} H${x + barW - r} Q${x + barW},${y0} ${x + barW},${y0 + r} V${y0 + h} Z`;
  };

  const linePath = net.map((v, i) => `${i === 0 ? "M" : "L"}${centerX(i)},${y(v)}`).join(" ");
  const sum = (key: "revenue" | "expense"): Money => months.reduce((acc, m) => acc.add(Money.of(m[key], currency)), Money.zero(currency));
  const totalRevenue = sum("revenue");
  const totalExpense = sum("expense");
  const totalNet = totalRevenue.subtract(totalExpense);

  const tip = hover !== null ? months[hover] : undefined;

  return (
    <figure className="erp-chart">
      <div className="erp-chart-wrap">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t("dashboard.chart.aria")} className="erp-chart__svg" direction="ltr" onMouseLeave={() => setHover(null)}>
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(tick)} y2={y(tick)} className="erp-chart__grid" />
              <text x={PAD.left - 8} y={y(tick) + 3.5} textAnchor="end" className="erp-chart__axis-label">
                {compact(tick)}
              </text>
            </g>
          ))}

          {months.map((m, i) => (
            <g key={m.month} className="erp-chart__col" onMouseEnter={() => setHover(i)}>
              <rect className="erp-chart__hit" x={centerX(i) - slot / 2} y={PAD.top} width={slot} height={PLOT_H + PAD.bottom} rx={8} />
              <path d={bar(centerX(i) - barW - 2, revenue[i] ?? 0)} className="erp-chart__bar erp-chart__bar--revenue" style={{ "--i": i } as React.CSSProperties} />
              <path d={bar(centerX(i) + 2, expense[i] ?? 0)} className="erp-chart__bar erp-chart__bar--expense" style={{ "--i": i } as React.CSSProperties} />
              <text x={centerX(i)} y={H - 9} textAnchor="middle" className="erp-chart__label">
                {monthLabel(m.month)}
              </text>
            </g>
          ))}

          <path d={linePath} className="erp-chart__line" pathLength={1} />
          {net.map((v, i) => (
            <circle key={months[i]?.month} cx={centerX(i)} cy={y(v)} r={3.6} className="erp-chart__dot" style={{ "--i": i } as React.CSSProperties} />
          ))}
        </svg>

        {tip && hover !== null ? (
          <div className="erp-chart__tip" style={{ left: `${(centerX(hover) / W) * 100}%`, top: `${(Math.min(y(revenue[hover] ?? 0), y(expense[hover] ?? 0)) / H) * 100}%` }}>
            <strong>{monthLabel(tip.month)}</strong>
            <div>
              <span>{t("dashboard.chart.revenue")}</span>
              <span>{formatMoney(tip.revenue, currency)}</span>
            </div>
            <div>
              <span>{t("dashboard.chart.expense")}</span>
              <span>{formatMoney(tip.expense, currency)}</span>
            </div>
            <div>
              <span>{t("dashboard.chartExtra.net")}</span>
              <span>{formatMoney(Money.of(tip.revenue, currency).subtract(Money.of(tip.expense, currency)).toDecimalString(4), currency)}</span>
            </div>
          </div>
        ) : null}
      </div>

      <figcaption className="erp-chart__legend">
        <span className="erp-chart__key erp-chart__key--revenue">{t("dashboard.chart.revenue")}</span>
        <span className="erp-chart__key erp-chart__key--expense">{t("dashboard.chart.expense")}</span>
        <span className="erp-chart__key erp-chart__key--net">{t("dashboard.chartExtra.net")}</span>
      </figcaption>

      <div className="erp-chart-summary">
        <div>
          <span>{t("dashboard.chartExtra.totalRevenue")}</span>
          <strong>{formatMoney(totalRevenue.toDecimalString(4), currency)}</strong>
        </div>
        <div>
          <span>{t("dashboard.chartExtra.totalExpense")}</span>
          <strong>{formatMoney(totalExpense.toDecimalString(4), currency)}</strong>
        </div>
        <div>
          <span>{t("dashboard.chartExtra.netResult")}</span>
          <strong>{formatMoney(totalNet.toDecimalString(4), currency)}</strong>
        </div>
      </div>
    </figure>
  );
}
