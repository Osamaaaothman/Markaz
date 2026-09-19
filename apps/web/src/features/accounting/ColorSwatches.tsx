import { useTranslation } from "react-i18next";
import { ACCOUNT_COLORS } from "@erp/shared";

// The palette a top-level account can be drawn in (one list shared with the API, which rejects
// anything else). The first swatch means "no colour": the row falls back to its account-type colour.
export function ColorSwatches({
  value,
  onChange,
  labelledBy,
}: {
  value: string | null;
  onChange: (color: string | null) => void;
  labelledBy: string;
}): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <div className="erp-swatches" role="radiogroup" aria-labelledby={labelledBy}>
      <button
        type="button"
        role="radio"
        aria-checked={value === null}
        aria-label={t("accounting.chartOfAccounts.noColor")}
        title={t("accounting.chartOfAccounts.noColor")}
        className={`erp-swatch erp-swatch--none${value === null ? " erp-swatch--selected" : ""}`}
        onClick={() => onChange(null)}
      >
        <i className="pi pi-ban" aria-hidden="true" />
      </button>
      {ACCOUNT_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          role="radio"
          aria-checked={value === color}
          aria-label={t("accounting.chartOfAccounts.colorOption", { value: color })}
          title={color}
          className={`erp-swatch${value === color ? " erp-swatch--selected" : ""}`}
          style={{ background: color }}
          onClick={() => onChange(color)}
        />
      ))}
    </div>
  );
}
