import { useTranslation } from "react-i18next";
import { CountUp, Reveal } from "../../shared/ui/Reveal";

export interface PulseBar {
  readonly key: "approvals" | "requests" | "purchaseOrders" | "quotations" | "salesOrders" | "reorder";
  readonly label: string;
  readonly icon: string;
  readonly count: number;
  readonly to: string;
}

// Every pending count the user may see (purchase requests, approvals, open orders on both sides,
// items under their reorder point) ranked as one strip of bars instead of scattered numbers — the
// biggest queue is the longest bar. A row with a zero count still gets a thin stub so the comparison
// stays honest (nothing is hidden just because it is currently quiet); the whole card instead shows
// the same "all clear" state as the attention list only when every one of them is zero.
export function ActivityPulse({ bars, onNavigate }: { readonly bars: readonly PulseBar[]; readonly onNavigate: (to: string) => void }): React.JSX.Element | null {
  const { t } = useTranslation();
  if (bars.length === 0) return null;

  const max = Math.max(...bars.map((b) => b.count), 1);
  const sorted = [...bars].sort((a, b) => b.count - a.count);
  const allClear = sorted.every((b) => b.count === 0);

  return (
    <Reveal className="erp-card mk-pulse-card">
      <h2 className="erp-card__title">{t("dashboard.pulse.title")}</h2>
      {allClear ? (
        <p className="erp-card__empty">
          <i className="pi pi-check-circle" aria-hidden="true" /> {t("dashboard.attention.allClear")}
        </p>
      ) : (
        <ul className="mk-pulse mk-stagger">
          {sorted.map((b, index) => (
            <li key={b.key} style={{ "--i": index } as React.CSSProperties}>
              <button type="button" className={`mk-pulse__row mk-pulse__row--${b.key}`} onClick={() => onNavigate(b.to)}>
                <span className="mk-pulse__icon">
                  <i className={b.icon} aria-hidden="true" />
                </span>
                <span className="mk-pulse__label">{b.label}</span>
                <span className="mk-pulse__track">
                  <span className="mk-pulse__fill" style={{ "--mk-pulse-pct": `${b.count > 0 ? Math.max((b.count / max) * 100, 6) : 0}%` } as React.CSSProperties} />
                </span>
                <span className="mk-pulse__value">
                  <CountUp value={b.count} delayMs={300 + index * 120} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Reveal>
  );
}
