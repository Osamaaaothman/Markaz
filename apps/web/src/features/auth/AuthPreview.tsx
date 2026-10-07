import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AnimatedMoney } from "../../shared/ui/AnimatedMoney";

// Decorative only: a sample journal entry that writes itself line by line, shows its totals counting up and
// stamps "balanced", then starts over with other numbers. It shows what the product promises (entries that
// always balance). The figures are fixed sample strings, labelled as a sample, never real data.
interface SampleEntry {
  readonly net: string;
  readonly vat: string;
  readonly gross: string;
}

const SAMPLES: readonly SampleEntry[] = [
  { net: "10000.00", vat: "1500.00", gross: "11500.00" },
  { net: "24000.00", vat: "3600.00", gross: "27600.00" },
  { net: "5200.00", vat: "780.00", gross: "5980.00" },
];

const LAST_STEP = 7;
const prefersReducedMotion = (): boolean => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function AuthPreview(): React.JSX.Element {
  const { t } = useTranslation();
  const [round, setRound] = useState(0);
  const [step, setStep] = useState(() => (prefersReducedMotion() ? LAST_STEP : 0));

  useEffect(() => {
    if (prefersReducedMotion()) return undefined;
    const timer = window.setInterval(() => {
      setStep((current) => {
        if (current < LAST_STEP) return current + 1;
        setRound((r) => (r + 1) % SAMPLES.length);
        return 0;
      });
    }, 1100);
    return () => window.clearInterval(timer);
  }, []);

  const sample = SAMPLES[round] ?? SAMPLES[0];
  if (!sample) return <></>;
  const rows = [
    { key: "receivable", debit: sample.gross, credit: null },
    { key: "revenue", debit: null, credit: sample.net },
    { key: "vat", debit: null, credit: sample.vat },
  ] as const;

  return (
    <div className="mk-preview" aria-hidden="true">
      <div className="mk-preview__head">
        <span>{t("authHero.preview.title")}</span>
        <em>{t("authHero.preview.sample")}</em>
      </div>
      <div className="mk-preview__cols">
        <span />
        <span>{t("authHero.preview.debit")}</span>
        <span>{t("authHero.preview.credit")}</span>
      </div>
      {rows.map((row, index) => (
        <div key={`${round}-${row.key}`} className={`mk-preview__row${step >= index + 1 ? " is-on" : ""}`}>
          <span>{t(`authHero.preview.${row.key}`)}</span>
          <span>{row.debit && step >= index + 1 ? <AnimatedMoney amount={row.debit} currency="SAR" /> : "—"}</span>
          <span>{row.credit && step >= index + 1 ? <AnimatedMoney amount={row.credit} currency="SAR" /> : "—"}</span>
        </div>
      ))}
      <div className={`mk-preview__total${step >= 4 ? " is-on" : ""}`}>
        <span>{t("authHero.preview.total")}</span>
        <span>{step >= 4 ? <AnimatedMoney key={`${round}-d`} amount={sample.gross} currency="SAR" /> : null}</span>
        <span>{step >= 4 ? <AnimatedMoney key={`${round}-c`} amount={sample.gross} currency="SAR" /> : null}</span>
      </div>
      <div className={`mk-preview__stamp${step >= 5 ? " is-on" : ""}`}>
        <i className="pi pi-check-circle" />
        {t("authHero.preview.balanced")}
      </div>
    </div>
  );
}
