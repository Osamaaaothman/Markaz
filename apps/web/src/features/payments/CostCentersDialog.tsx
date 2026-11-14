import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog } from "primereact/dialog";
import { Button } from "primereact/button";
import { InputText } from "primereact/inputtext";
import { Dropdown } from "primereact/dropdown";
import { Checkbox } from "primereact/checkbox";
import { Column } from "primereact/column";
import { DataTable } from "primereact/datatable";
import { LineField } from "../../shared/ui/LineField";
import { usePermissions } from "../../shared/auth/use-permissions";
import { localizedName } from "../../shared/lib/localized-name";
import { useCostCenters, useSaveCostCenter, type CostCenter, type CostCenterInput } from "./use-cost-centers";

const empty = (): CostCenterInput => ({ code: "", name: "", nameAr: "", kind: "COST_CENTER", isActive: true });

export function CostCentersDialog({ visible, onHide }: { visible: boolean; onHide: () => void }): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const { can } = usePermissions();
  const centers = useCostCenters(visible);
  const save = useSaveCostCenter();
  const [id, setId] = useState<string>();
  const [form, setForm] = useState(empty);
  const reset = (): void => { setId(undefined); setForm(empty()); save.reset(); };
  const errorCode = (save.error as { response?: { data?: { error?: { code?: string } } } } | null)?.response?.data?.error?.code;
  const canSave = can(id ? "account:update" : "account:create");
  return <Dialog visible={visible} onHide={onHide} header={t("costCenters.title")} style={{ width: "64rem", maxWidth: "95vw" }} modal>
    {centers.isError ? <p role="alert">{t("status.error")} <Button label={t("actions.retry")} text onClick={() => void centers.refetch()} /></p> : null}
    <DataTable value={centers.data ?? []} loading={centers.isPending} paginator rows={10} emptyMessage={t("status.empty")}>
      <Column field="code" header={t("costCenters.code")} />
      <Column header={t("costCenters.name")} body={(row: CostCenter) => localizedName(row, i18n.language)} />
      <Column header={t("costCenters.kind")} body={(row: CostCenter) => t(`costCenters.kinds.${row.kind}`)} />
      <Column header={t("costCenters.active")} body={(row: CostCenter) => t(row.isActive ? "costCenters.active" : "costCenters.inactive")} />
      {can("account:update") ? <Column body={(row: CostCenter) => <Button label={t("actions.edit")} text disabled={save.isPending} onClick={() => { setId(row.id); setForm({ code: row.code, name: row.name, nameAr: row.nameAr ?? "", kind: row.kind, isActive: row.isActive }); save.reset(); }} />} /> : null}
    </DataTable>
    {can("account:create") || can("account:update") ? <div className="erp-form">
      <h3>{t(id ? "costCenters.edit" : "costCenters.new")}</h3>
      <div className="erp-form__row">
        <LineField label={t("costCenters.code")}><InputText value={form.code} maxLength={50} disabled={save.isPending} onChange={(e) => setForm({ ...form, code: e.target.value })} /></LineField>
        <LineField label={t("costCenters.name")}><InputText value={form.name} maxLength={200} disabled={save.isPending} onChange={(e) => setForm({ ...form, name: e.target.value })} /></LineField>
        <LineField label={t("costCenters.nameAr")}><InputText value={form.nameAr} maxLength={200} disabled={save.isPending} onChange={(e) => setForm({ ...form, nameAr: e.target.value })} /></LineField>
      </div>
      <div className="erp-form__row">
        <LineField label={t("costCenters.kind")}><Dropdown value={form.kind} disabled={save.isPending} options={["COST_CENTER", "PROJECT", "DEPARTMENT"].map((kind) => ({ value: kind, label: t(`costCenters.kinds.${kind}`) }))} onChange={(e) => setForm({ ...form, kind: e.value as CostCenterInput["kind"] })} /></LineField>
        <LineField label={t("costCenters.active")}><Checkbox checked={form.isActive} disabled={save.isPending} onChange={(e) => setForm({ ...form, isActive: e.checked ?? false })} /></LineField>
      </div>
      {save.isError ? <p role="alert" className="erp-page__error">{t(errorCode === "COST_CENTER_DUPLICATE" ? "costCenters.duplicate" : "status.error")}</p> : null}
      <div className="erp-form__actions">
        <Button label={t("actions.cancel")} text onClick={reset} disabled={save.isPending} />
        <Button label={t("actions.save")} loading={save.isPending} disabled={!canSave || !form.code.trim() || !form.name.trim()} onClick={() => save.mutate({ ...form, ...(id ? { id } : {}) }, { onSuccess: reset })} />
      </div>
    </div> : null}
  </Dialog>;
}
