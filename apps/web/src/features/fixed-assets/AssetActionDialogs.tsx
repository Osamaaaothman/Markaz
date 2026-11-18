import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "primereact/button";
import { Calendar } from "primereact/calendar";
import { Dialog } from "primereact/dialog";
import { Dropdown } from "primereact/dropdown";
import { InputText } from "primereact/inputtext";
import { InputTextarea } from "primereact/inputtextarea";
import { toDateOnlyIsoString } from "../../shared/lib/format-date";
import { localizedName } from "../../shared/lib/localized-name";
import { formatAmount } from "../../shared/lib/money";
import { useAccounts } from "../accounting/use-accounts";
import { useAllEmployees } from "../hr/use-hr";
import { useCostCenters } from "../payments/use-cost-centers";
import {
  fixedAssetErrorKey,
  useAssetCategories,
  useCapitalizeAsset,
  useDisposalPreview,
  useDisposeAsset,
  useTransferAsset,
  useUpdateAssetInfo,
  type DisposalType,
  type FixedAssetDetail,
} from "./use-fixed-assets";

interface DialogProps {
  readonly asset: FixedAssetDetail;
  readonly visible: boolean;
  readonly onHide: () => void;
}

interface EntryLine {
  readonly key: string;
  readonly account: string;
  readonly debit: string;
  readonly credit: string;
}

// A small double-entry table: what the action will post, before the user confirms it.
function EntryPreview({ lines, currency }: { readonly lines: readonly EntryLine[]; readonly currency: string }): React.JSX.Element {
  const { t } = useTranslation();
  const blank = (v: string): string => (/^0(\.0+)?$/.test(v) ? "" : formatAmount(v, currency));
  return (
    <div className="fa-entry">
      <table>
        <thead>
          <tr>
            <th>{t("fixedAssets.entry.account")}</th>
            <th className="fa-amount">{t("fixedAssets.entry.debit")}</th>
            <th className="fa-amount">{t("fixedAssets.entry.credit")}</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.key}>
              <td>{l.account}</td>
              <td className="fa-amount" dir="ltr">{blank(l.debit)}</td>
              <td className="fa-amount" dir="ltr">{blank(l.credit)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const dialogStyle = { width: "min(34rem, 96vw)" };

export function CapitalizeDialog({ asset, visible, onHide }: DialogProps): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const accounts = useAccounts();
  const categories = useAssetCategories(true);
  const capitalize = useCapitalizeAsset(asset.id);
  const [sourceAccountId, setSourceAccountId] = useState("");
  const category = categories.data?.find((c) => c.id === asset.category.id);
  const own = new Set([category?.assetAccount.id, category?.accumulatedDepreciationAccount?.id, category?.depreciationExpenseAccount?.id]);
  const options = (accounts.data ?? []).filter((a) => !own.has(a.id)).map((a) => ({ label: `${a.code} — ${localizedName(a, i18n.language)}`, value: a.id }));
  const source = accounts.data?.find((a) => a.id === sourceAccountId);
  const label = (r: { code: string; name: string; nameAr: string | null } | undefined): string => (r ? `${r.code} — ${localizedName(r, i18n.language)}` : "—");

  return (
    <Dialog header={t("fixedAssets.capitalize.title")} visible={visible} onHide={onHide} className="erp-dialog" modal style={dialogStyle}>
      <div className="erp-form">
        <p className="erp-field__hint">{t("fixedAssets.capitalize.intro")}</p>
        <div className="erp-field">
          <label htmlFor="capSource">{t("fixedAssets.capitalize.sourceAccount")}</label>
          <Dropdown inputId="capSource" value={sourceAccountId || null} options={options} onChange={(e) => { setSourceAccountId((e.value as string | null) ?? ""); capitalize.reset(); }} filter loading={accounts.isPending} />
          <small className="erp-field__hint">{t("fixedAssets.capitalize.sourceHint")}</small>
        </div>
        {sourceAccountId ? (
          <>
            <h4 className="erp-form__section-title">{t("fixedAssets.capitalize.entryPreview")}</h4>
            <EntryPreview
              currency={asset.currency}
              lines={[
                { key: "asset", account: label(category?.assetAccount), debit: asset.acquisitionCost, credit: "0" },
                { key: "source", account: label(source), debit: "0", credit: asset.acquisitionCost },
              ]}
            />
          </>
        ) : null}
        {capitalize.isError ? <p className="erp-auth-card__error">{t(fixedAssetErrorKey(capitalize.error))}</p> : null}
        <div className="erp-form__actions">
          <Button type="button" label={t("actions.cancel")} text onClick={onHide} />
          <Button type="button" icon="pi pi-check" label={t("fixedAssets.capitalize.confirm")} disabled={!sourceAccountId} loading={capitalize.isPending} onClick={() => capitalize.mutate(sourceAccountId, { onSuccess: onHide })} />
        </div>
      </div>
    </Dialog>
  );
}

export function TransferDialog({ asset, visible, onHide }: DialogProps): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const employees = useAllEmployees();
  const centers = useCostCenters();
  const transfer = useTransferAsset(asset.id);
  const [date, setDate] = useState<Date>(new Date());
  const [location, setLocation] = useState(asset.location ?? "");
  const [custodian, setCustodian] = useState(asset.custodian?.id ?? "");
  const [center, setCenter] = useState(asset.costCenter?.id ?? "");
  const [reason, setReason] = useState("");
  const changed = location.trim() !== (asset.location ?? "") || custodian !== (asset.custodian?.id ?? "") || center !== (asset.costCenter?.id ?? "");

  const submit = (): void => {
    transfer.mutate(
      { transferDate: toDateOnlyIsoString(date), location: location.trim(), custodianEmployeeId: custodian, costCenterId: center, ...(reason.trim() ? { reason: reason.trim() } : {}) },
      { onSuccess: onHide },
    );
  };

  return (
    <Dialog header={t("fixedAssets.transfer.title")} visible={visible} onHide={onHide} className="erp-dialog" modal style={dialogStyle}>
      <div className="erp-form">
        <p className="erp-field__hint">{t("fixedAssets.transfer.intro")}</p>
        <div className="erp-form__row">
          <div className="erp-field">
            <label htmlFor="trDate">{t("fixedAssets.transfer.date")}</label>
            <Calendar inputId="trDate" value={date} onChange={(e) => e.value && setDate(e.value)} dateFormat="yy-mm-dd" showIcon />
          </div>
          <div className="erp-field">
            <label htmlFor="trLocation">{t("fixedAssets.transfer.location")}</label>
            <InputText id="trLocation" value={location} onChange={(e) => setLocation(e.target.value)} maxLength={200} />
          </div>
        </div>
        <div className="erp-field">
          <label htmlFor="trCustodian">{t("fixedAssets.transfer.custodian")}</label>
          <Dropdown inputId="trCustodian" value={custodian || null} options={(employees.data ?? []).map((e) => ({ label: `${e.ref} — ${localizedName(e, i18n.language)}`, value: e.id }))} onChange={(e) => setCustodian((e.value as string | null) ?? "")} filter showClear placeholder={t("fixedAssets.transfer.none")} />
        </div>
        <div className="erp-field">
          <label htmlFor="trCenter">{t("fixedAssets.transfer.costCenter")}</label>
          <Dropdown inputId="trCenter" value={center || null} options={(centers.data ?? []).filter((c) => c.isActive).map((c) => ({ label: `${c.code} — ${localizedName(c, i18n.language)}`, value: c.id }))} onChange={(e) => setCenter((e.value as string | null) ?? "")} filter showClear placeholder={t("fixedAssets.transfer.none")} />
        </div>
        <div className="erp-field">
          <label htmlFor="trReason">{t("fixedAssets.transfer.reason")}</label>
          <InputText id="trReason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        </div>
        {transfer.isError ? <p className="erp-auth-card__error">{t(fixedAssetErrorKey(transfer.error))}</p> : null}
        <div className="erp-form__actions">
          <Button type="button" label={t("actions.cancel")} text onClick={onHide} />
          <Button type="button" icon="pi pi-arrow-right-arrow-left" label={t("fixedAssets.transfer.confirm")} disabled={!changed} loading={transfer.isPending} onClick={submit} />
        </div>
      </div>
    </Dialog>
  );
}

const DISPOSAL_TYPES: readonly DisposalType[] = ["SCRAP", "LOSS", "WRITE_OFF"];

export function DisposeDialog({ asset, visible, onHide }: DialogProps): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const dispose = useDisposeAsset(asset.id);
  const [date, setDate] = useState<Date>(new Date());
  const [type, setType] = useState<DisposalType>("SCRAP");
  const [reason, setReason] = useState("");
  const isoDate = toDateOnlyIsoString(date);
  const preview = useDisposalPreview(visible ? asset.id : "", visible ? isoDate : null);
  const lines = useMemo<EntryLine[]>(
    () => (preview.data?.lines ?? []).map((l, i) => ({ key: `${i}`, account: l.accountCode ? `${l.accountCode} — ${localizedName({ name: l.accountName, nameAr: l.accountNameAr }, i18n.language)}` : t("fixedAssets.dispose.loss"), debit: l.debit, credit: l.credit })),
    [preview.data, i18n.language, t],
  );
  const money = (v: string): string => formatAmount(v, asset.currency);

  return (
    <Dialog header={t("fixedAssets.dispose.title")} visible={visible} onHide={onHide} className="erp-dialog" modal style={{ width: "min(40rem, 96vw)" }}>
      <div className="erp-form">
        <p className="erp-field__hint">{t("fixedAssets.dispose.intro")}</p>
        <div className="erp-form__row">
          <div className="erp-field">
            <label htmlFor="dsDate">{t("fixedAssets.dispose.date")}</label>
            <Calendar inputId="dsDate" value={date} onChange={(e) => { if (e.value) { setDate(e.value); dispose.reset(); } }} dateFormat="yy-mm-dd" showIcon />
          </div>
          <div className="erp-field">
            <label htmlFor="dsType">{t("fixedAssets.dispose.type")}</label>
            <Dropdown inputId="dsType" value={type} options={DISPOSAL_TYPES.map((d) => ({ label: t(`fixedAssets.disposalTypes.${d}`), value: d }))} onChange={(e) => setType((e.value as DisposalType | null) ?? "SCRAP")} />
          </div>
        </div>
        <div className="erp-field">
          <label htmlFor="dsReason">{t("fixedAssets.dispose.reason")}</label>
          <InputTextarea id="dsReason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} autoResize maxLength={500} />
        </div>

        <h4 className="erp-form__section-title">{t("fixedAssets.dispose.previewTitle")}</h4>
        {preview.isError ? (
          <p className="erp-auth-card__error">{t(fixedAssetErrorKey(preview.error))}</p>
        ) : preview.data ? (
          <>
            <dl className="mk-facts">
              <div>
                <dt>{t("fixedAssets.dispose.finalDepreciation")}</dt>
                <dd dir="ltr">{money(preview.data.finalDepreciationAmount)} <span className="fa-muted">({t("fixedAssets.dispose.finalDays", { count: preview.data.finalDepreciationDays })})</span></dd>
              </div>
              <div>
                <dt>{t("fixedAssets.fields.accumulatedDepreciation")}</dt>
                <dd dir="ltr">{money(preview.data.accumulatedAtDisposal)}</dd>
              </div>
              <div>
                <dt>{t("fixedAssets.dispose.bookValue")}</dt>
                <dd dir="ltr"><strong>{money(preview.data.netBookValue)}</strong></dd>
              </div>
            </dl>
            <EntryPreview lines={lines} currency={asset.currency} />
          </>
        ) : (
          <p className="fa-muted">{t("status.loading")}</p>
        )}
        <p className="fa-notice fa-notice--warning"><i className="pi pi-exclamation-triangle" /> {t("fixedAssets.dispose.irreversible")} {t("fixedAssets.dispose.salesNote")}</p>
        {dispose.isError ? <p className="erp-auth-card__error">{t(fixedAssetErrorKey(dispose.error))}</p> : null}
        <div className="erp-form__actions">
          <Button type="button" label={t("actions.cancel")} text onClick={onHide} />
          <Button type="button" severity="danger" icon="pi pi-trash" label={t("fixedAssets.dispose.confirm")} disabled={!reason.trim() || !preview.data} loading={dispose.isPending} onClick={() => dispose.mutate({ disposalDate: isoDate, disposalType: type, reason: reason.trim() }, { onSuccess: onHide })} />
        </div>
      </div>
    </Dialog>
  );
}

export function EditInfoDialog({ asset, visible, onHide }: DialogProps): React.JSX.Element {
  const { t } = useTranslation();
  const update = useUpdateAssetInfo(asset.id);
  const [name, setName] = useState(asset.name);
  const [nameAr, setNameAr] = useState(asset.nameAr ?? "");
  const [description, setDescription] = useState(asset.description ?? "");
  const [serialNumber, setSerialNumber] = useState(asset.serialNumber ?? "");
  const [barcode, setBarcode] = useState(asset.barcode ?? "");

  return (
    <Dialog header={t("fixedAssets.editInfo.title")} visible={visible} onHide={onHide} className="erp-dialog" modal style={dialogStyle}>
      <div className="erp-form">
        <p className="erp-field__hint">{t("fixedAssets.editInfo.intro")}</p>
        <div className="erp-form__row">
          <div className="erp-field">
            <label htmlFor="eiName">{t("fixedAssets.fields.name")}</label>
            <InputText id="eiName" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
          </div>
          <div className="erp-field">
            <label htmlFor="eiNameAr">{t("fixedAssets.fields.nameAr")}</label>
            <InputText id="eiNameAr" value={nameAr} onChange={(e) => setNameAr(e.target.value)} maxLength={200} dir="rtl" />
          </div>
        </div>
        <div className="erp-form__row">
          <div className="erp-field">
            <label htmlFor="eiSerial">{t("fixedAssets.fields.serialNumber")}</label>
            <InputText id="eiSerial" value={serialNumber} onChange={(e) => setSerialNumber(e.target.value)} dir="ltr" maxLength={100} />
          </div>
          <div className="erp-field">
            <label htmlFor="eiBarcode">{t("fixedAssets.fields.barcode")}</label>
            <InputText id="eiBarcode" value={barcode} onChange={(e) => setBarcode(e.target.value)} dir="ltr" maxLength={100} />
          </div>
        </div>
        <div className="erp-field">
          <label htmlFor="eiDesc">{t("fixedAssets.fields.description")}</label>
          <InputTextarea id="eiDesc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} autoResize maxLength={1000} />
        </div>
        {update.isError ? <p className="erp-auth-card__error">{t(fixedAssetErrorKey(update.error))}</p> : null}
        <div className="erp-form__actions">
          <Button type="button" label={t("actions.cancel")} text onClick={onHide} />
          <Button
            type="button"
            icon="pi pi-save"
            label={t("fixedAssets.form.saveChanges")}
            disabled={!name.trim()}
            loading={update.isPending}
            onClick={() => update.mutate({ name: name.trim(), nameAr: nameAr.trim(), description: description.trim(), serialNumber: serialNumber.trim(), barcode: barcode.trim() }, { onSuccess: onHide })}
          />
        </div>
      </div>
    </Dialog>
  );
}
