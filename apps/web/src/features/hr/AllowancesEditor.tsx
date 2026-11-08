import { useTranslation } from "react-i18next";
import { Button } from "primereact/button";
import { Dropdown } from "primereact/dropdown";
import { InputText } from "primereact/inputtext";
import { localizedName } from "../../shared/lib/localized-name";
import type { AllowanceTypeSummary } from "./use-allowance-types";

export interface AllowanceRow {
  readonly allowanceTypeId: string;
  readonly amount: string;
}

// The rows of "what is this employee paid besides basic salary": one allowance type and an amount per row. A type already used
// in another row is not offered again. Rows with no type or a zero amount are dropped when saved.
export function AllowancesEditor({
  rows,
  onChange,
  types,
}: {
  readonly rows: readonly AllowanceRow[];
  readonly onChange: (rows: readonly AllowanceRow[]) => void;
  readonly types: readonly AllowanceTypeSummary[];
}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const update = (index: number, patch: Partial<AllowanceRow>): void => onChange(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));

  return (
    <div className="erp-field">
      <label>{t("hr.allowances.title")}</label>
      {types.length === 0 ? <small className="erp-field__hint">{t("hr.allowances.noTypes")}</small> : null}
      <div className="erp-lines">
        {rows.map((row, index) => (
          <div key={index} className="erp-lines__row">
            <Dropdown
              className="erp-lines__account"
              value={row.allowanceTypeId || null}
              onChange={(e) => update(index, { allowanceTypeId: (e.value as string | null) ?? "" })}
              options={types
                .filter((type) => type.id === row.allowanceTypeId || !rows.some((r) => r.allowanceTypeId === type.id))
                .map((type) => ({ label: localizedName(type, i18n.language), value: type.id }))}
              placeholder={t("hr.allowances.chooseType")}
              aria-label={t("hr.allowances.chooseType")}
            />
            <InputText
              className="erp-lines__amount"
              dir="ltr"
              value={row.amount}
              onChange={(e) => update(index, { amount: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter" && types.length > 0 && index === rows.length - 1) {
                  e.preventDefault();
                  onChange([...rows, { allowanceTypeId: "", amount: "" }]);
                }
              }}
              aria-label={t("hr.allowances.amount")}
              placeholder={t("hr.allowances.amount")}
            />
            <Button type="button" icon="pi pi-trash" text severity="danger" aria-label={t("actions.removeLine")} onClick={() => onChange(rows.filter((_, i) => i !== index))} />
          </div>
        ))}
      </div>
      <Button type="button" label={t("hr.allowances.add")} icon="pi pi-plus" text disabled={types.length === 0} onClick={() => onChange([...rows, { allowanceTypeId: "", amount: "" }])} />
    </div>
  );
}

// What goes to the server: only complete rows with a valid positive amount.
export function allowancePayload(rows: readonly AllowanceRow[]): { allowanceTypeId: string; amount: string }[] {
  return rows
    .filter((r) => r.allowanceTypeId !== "" && /^\d{1,15}(\.\d{1,4})?$/.test(r.amount.trim()) && Number(r.amount) > 0)
    .map((r) => ({ allowanceTypeId: r.allowanceTypeId, amount: r.amount.trim() }));
}

// True when a row has an amount that is not a valid number (so the form can refuse to save instead of silently dropping it).
export function hasInvalidAllowance(rows: readonly AllowanceRow[]): boolean {
  return rows.some((r) => r.amount.trim() !== "" && !/^\d{1,15}(\.\d{1,4})?$/.test(r.amount.trim()));
}
