import { useState } from "react";
import { useTranslation } from "react-i18next";
import { formatMoney } from "../../shared/lib/money";
import { CountUp, Reveal } from "../../shared/ui/Reveal";

type Accent = "receivables" | "payables" | "cash";

interface Segment {
  readonly key: Accent;
  readonly label: string;
  readonly amount: string;
  readonly value: number;
}

interface Arc extends Segment {
  readonly pct: number;
  readonly share: number;
  readonly offset: number;
}

// A visible gap between neighbouring slices, in percent of the circle.
const GAP = 1.4;

// How the three money positions (owed to the company, owed by it, and what sits in the bank) relate to
// one another, as a single thin ring instead of three separate numbers. Shown only once at least two of the
// three exist and together they are worth something — one lone full circle would claim a proportion that was
// never compared to anything. The centre only ever holds a short percentage and a label; the exact amounts
// live in the legend, so no long figure can collide with the ring. Hovering or focusing a slice or a legend
// row highlights both. Nothing is summed across the three: a receivable, a payable and a cash balance are
// not the same kind of amount.
export function CompositionDonut({
  receivables,
  payables,
  cash,
  currency,
}: {
  readonly receivables?: string | undefined;
  readonly payables?: string | undefined;
  readonly cash?: string | null | undefined;
  readonly currency: string;
}): React.JSX.Element | null {
  const { t } = useTranslation();
  const [active, setActive] = useState<number | null>(null);

  const segments: Segment[] = [
    ...(receivables !== undefined ? [{ key: "receivables" as const, label: t("dashboard.kpi.receivables"), amount: receivables, value: Math.max(Number(receivables), 0) }] : []),
    ...(payables !== undefined ? [{ key: "payables" as const, label: t("dashboard.kpi.payables"), amount: payables, value: Math.max(Number(payables), 0) }] : []),
    ...(cash !== undefined && cash !== null ? [{ key: "cash" as const, label: t("dashboard.kpi.cash"), amount: cash, value: Math.max(Number(cash), 0) }] : []),
  ];
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  if (segments.length < 2 || total <= 0) return null;

  let cumulative = 0;
  const arcs: Arc[] = segments.map((s) => {
    const share = (s.value / total) * 100;
    const pct = Math.max(share - GAP, 0.6);
    const offset = -(cumulative + GAP / 2);
    cumulative += share;
    return { ...s, pct, share, offset };
  });
  const hovered = active !== null ? arcs[active] : undefined;

  return (
    <Reveal className="erp-card mk-donut-card">
      <h2 className="erp-card__title">{t("dashboard.composition.title")}</h2>
      <div className="mk-donut-wrap">
        <svg viewBox="0 0 36 36" className="mk-donut" role="img" aria-label={t("dashboard.composition.title")} onMouseLeave={() => setActive(null)}>
          <circle className="mk-donut__track" cx="18" cy="18" r="15.9155" />
          {arcs.map((a, i) => (
            <circle
              key={a.key}
              className={`mk-donut__arc mk-donut__arc--${a.key}${active === i ? " mk-donut__arc--on" : ""}${active !== null && active !== i ? " mk-donut__arc--dim" : ""}`}
              cx="18"
              cy="18"
              r="15.9155"
              pathLength={100}
              tabIndex={0}
              role="button"
              aria-label={`${a.label} ${formatMoney(a.amount, currency)}`}
              style={{ "--mk-arc-len": a.pct, "--mk-arc-offset": a.offset, "--i": i } as React.CSSProperties}
              onMouseEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
            />
          ))}
        </svg>
        <div className="mk-donut__center">
          {hovered ? (
            <>
              <strong>{Math.round(hovered.share)}%</strong>
              <span>{hovered.label}</span>
            </>
          ) : (
            <>
              <strong>{currency}</strong>
              <span>{t("dashboard.composition.caption")}</span>
            </>
          )}
        </div>
      </div>
      <ul className="mk-donut__legend">
        {arcs.map((a, i) => (
          <li key={a.key} className={`mk-donut__legend-item mk-donut__legend-item--${a.key}`} style={{ "--i": i } as React.CSSProperties} onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)}>
            <span className="mk-donut__dot" aria-hidden="true" />
            <span className="mk-donut__name">{a.label}</span>
            <strong className="mk-donut__pct">
              <CountUp value={Math.round(a.share)} delayMs={700 + i * 320} />%
            </strong>
            <span className="mk-donut__amount" dir="ltr">
              {formatMoney(a.amount, currency)}
            </span>
          </li>
        ))}
      </ul>
    </Reveal>
  );
}
