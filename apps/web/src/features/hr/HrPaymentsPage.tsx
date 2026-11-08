import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Button } from "primereact/button";
import { Calendar } from "primereact/calendar";
import { Column } from "primereact/column";
import { Dialog } from "primereact/dialog";
import { Dropdown } from "primereact/dropdown";
import { InputText } from "primereact/inputtext";
import { Tag } from "primereact/tag";
import { usePermissions } from "../../shared/auth/use-permissions";
import { formatCalendarDate, toDateOnlyIsoString } from "../../shared/lib/format-date";
import { localizedName } from "../../shared/lib/localized-name";
import { formatMoney } from "../../shared/lib/money";
import { CreatedDialog, type CreatedInfo } from "../../shared/ui/CreatedDialog";
import { DataGrid } from "../../shared/ui/DataGrid";
import { PageSkeleton } from "../../shared/ui/PageSkeleton";
import { PermissionButton } from "../../shared/ui/PermissionButton";
import { useChartOfAccounts } from "../accounting/use-chart-of-accounts";
import {
  hrPaymentErrorCode,
  useHrPayables,
  useHrPayments,
  usePayEndOfService,
  usePayGosi,
  usePaySalaries,
  type HrPaymentKind,
  type HrPaymentSummary,
} from "./use-hr-payments";

const AMOUNT = /^\d{1,15}(\.\d{1,4})?$/;

// Paying what payroll and end-of-service left owed. Each payment lowers the debt it was recorded under and the bank by the same amount.
export function HrPaymentsPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const { can } = usePermissions();
  const navigate = useNavigate();
  const { data, isPending, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } = useHrPayments();
  const { data: payables } = useHrPayables();
  const [dialog, setDialog] = useState<HrPaymentKind | null>(null);
  const [created, setCreated] = useState<CreatedInfo | null>(null);
  const rows = data?.pages.flatMap((p) => p.data) ?? [];
  const currency = payables?.currency ?? "SAR";
  const unpaidSalaries = payables?.runs.reduce((s, r) => s + Number(r.unpaidTotal), 0) ?? 0;
  const unpaidGratuities = payables?.settlements.reduce((s, r) => s + Number(r.amount), 0) ?? 0;

  return (
    <div className="erp-page">
      <div className="erp-page__header">
        <div>
          <h1 className="erp-page__title">{t("hr.payments.title")}</h1>
          <p className="erp-page__subtitle">{t("hr.payments.subtitle")}</p>
        </div>
        <div className="erp-row-actions">
          <PermissionButton allowed={can("hr_payment:create")} label={t("hr.payments.paySalaries")} icon="pi pi-wallet" disabled={(payables?.runs.length ?? 0) === 0} onClick={() => setDialog("SALARY")} />
          <PermissionButton allowed={can("hr_payment:create")} label={t("hr.payments.payGosi")} icon="pi pi-shield" outlined disabled={Number(payables?.gosiOutstanding ?? 0) <= 0} onClick={() => setDialog("GOSI")} />
          <PermissionButton allowed={can("hr_payment:create")} label={t("hr.payments.payGratuity")} icon="pi pi-sign-out" outlined disabled={(payables?.settlements.length ?? 0) === 0} onClick={() => setDialog("END_OF_SERVICE")} />
        </div>
      </div>

      <dl className="mk-facts">
        <div>
          <dt>{t("hr.payments.owedSalaries")}</dt>
          <dd dir="ltr">{formatMoney(unpaidSalaries.toFixed(4), currency)}</dd>
        </div>
        <div>
          <dt>{t("hr.payments.owedGosi")}</dt>
          <dd dir="ltr">{formatMoney(payables?.gosiOutstanding ?? "0", currency)}</dd>
        </div>
        <div>
          <dt>{t("hr.payments.owedGratuities")}</dt>
          <dd dir="ltr">{formatMoney(unpaidGratuities.toFixed(4), currency)}</dd>
        </div>
      </dl>

      {isPending ? (
        <PageSkeleton />
      ) : isError ? (
        <div className="erp-page">
          <p className="erp-page__error">{t("status.error")}</p>
          <button type="button" className="erp-button-link" onClick={() => void refetch()}>
            {t("actions.retry")}
          </button>
        </div>
      ) : (
        <>
          <DataGrid value={rows} className="erp-table" stripedRows showGridlines size="small" emptyMessage={t("hr.payments.empty")}>
            <Column header={t("purchasing.number")} style={{ width: "12rem" }} body={(r: HrPaymentSummary) => <button type="button" className="erp-button-link coa-code" onClick={() => void navigate(`/hr/payments/${r.id}`)}>{r.number}</button>} />
            <Column header={t("hr.payments.kind")} style={{ width: "11rem" }} body={(r: HrPaymentSummary) => <Tag value={t(`hr.payments.kinds.${r.kind}`)} severity={r.kind === "SALARY" ? "success" : r.kind === "GOSI" ? "info" : "warning"} />} />
            <Column header={t("payments.date")} style={{ width: "9rem" }} body={(r: HrPaymentSummary) => formatCalendarDate(r.paymentDate, i18n.language)} />
            <Column header={t("hr.payments.for")} body={(r: HrPaymentSummary) => (r.payrollRunNumber ?? (r.employeeName ? localizedName({ name: r.employeeName, nameAr: r.employeeNameAr }, i18n.language) : "—"))} />
            <Column header={t("payments.amount")} align="right" style={{ width: "12rem" }} body={(r: HrPaymentSummary) => <strong>{formatMoney(r.amount, r.currency)}</strong>} />
          </DataGrid>
          {hasNextPage ? (
            <div className="erp-table-footer erp-table-footer--center">
              <Button label={t("actions.loadMore")} text onClick={() => void fetchNextPage()} loading={isFetchingNextPage} icon="pi pi-chevron-down" />
            </div>
          ) : null}
        </>
      )}

      <PayDialog kind={dialog} onHide={() => setDialog(null)} onCreated={setCreated} />
      <CreatedDialog info={created} onHide={() => setCreated(null)} />
    </div>
  );
}

// One dialog for the three payments: the same date and bank account, plus what is specific to each.
function PayDialog({
  kind,
  onHide,
  onCreated,
}: {
  readonly kind: HrPaymentKind | null;
  readonly onHide: () => void;
  readonly onCreated: (info: CreatedInfo) => void;
}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { data: payables } = useHrPayables();
  const { data: accounts } = useChartOfAccounts();
  const salaries = usePaySalaries();
  const gosi = usePayGosi();
  const gratuity = usePayEndOfService();
  const [date, setDate] = useState<Date>(new Date());
  const [cash, setCash] = useState("");
  const [target, setTarget] = useState("");
  const [amount, setAmount] = useState("");
  const banks = (accounts ?? []).filter((a) => a.isPostable && a.type === "ASSET");
  const mutation = kind === "SALARY" ? salaries : kind === "GOSI" ? gosi : gratuity;
  const code = hrPaymentErrorCode(mutation.error);

  const reset = (): void => {
    setDate(new Date());
    setCash("");
    setTarget("");
    setAmount(kind === "GOSI" ? String(Number(payables?.gosiOutstanding ?? 0)) : "");
    salaries.reset();
    gosi.reset();
    gratuity.reset();
  };

  const done = (saved: { id: string; number: string }): void => {
    onHide();
    const bank = banks.find((a) => a.id === cash);
    const currency = payables?.currency ?? "SAR";
    const paidAmount =
      kind === "GOSI"
        ? amount
        : kind === "SALARY"
          ? (payables?.runs.find((r) => r.payrollRunId === target)?.unpaidTotal ?? "")
          : (payables?.settlements.find((s) => s.settlementId === target)?.amount ?? "");
    onCreated({
      title: t(`hr.payments.kinds.${kind ?? "SALARY"}`),
      headline: saved.number,
      onOpen: () => void navigate(`/hr/payments/${saved.id}`),
      rows: [
        { label: t("payments.date"), value: toDateOnlyIsoString(date), ltr: true },
        { label: t("payments.bankAccount"), value: bank ? localizedName(bank, i18n.language) : "" },
        { label: t("payments.amount"), value: paidAmount ? formatMoney(paidAmount, currency) : "", ltr: true },
      ],
    });
  };

  const common = { paymentDate: toDateOnlyIsoString(date), cashAccountId: cash };
  const submit = (): void => {
    if (kind === "SALARY") salaries.mutate({ ...common, payrollRunId: target }, { onSuccess: done });
    else if (kind === "GOSI") gosi.mutate({ ...common, amount }, { onSuccess: done });
    else if (kind === "END_OF_SERVICE") gratuity.mutate({ ...common, settlementId: target }, { onSuccess: done });
  };
  const ready = cash !== "" && (kind === "GOSI" ? AMOUNT.test(amount) && Number(amount) > 0 : target !== "");

  return (
    <Dialog
      header={t(`hr.payments.dialogs.${kind ?? "SALARY"}`)}
      visible={kind !== null}
      onHide={onHide}
      onShow={reset}
      className="erp-dialog"
      modal
      style={{ width: "min(34rem, 96vw)" }}
    >
      <div className="erp-form">
        {kind === "SALARY" ? (
          <div className="erp-field">
            <label htmlFor="hpRun">{t("hr.payments.run")}</label>
            <Dropdown
              inputId="hpRun"
              value={target || null}
              onChange={(e) => setTarget((e.value as string | null) ?? "")}
              options={(payables?.runs ?? []).map((r) => ({ label: `${r.number} — ${t("hr.payments.unpaid", { count: r.unpaidCount, total: formatMoney(r.unpaidTotal, payables?.currency ?? "SAR") })}`, value: r.payrollRunId }))}
              placeholder={t("hr.payments.pickRun")}
            />
          </div>
        ) : null}
        {kind === "END_OF_SERVICE" ? (
          <div className="erp-field">
            <label htmlFor="hpSettlement">{t("hr.payments.settlement")}</label>
            <Dropdown
              inputId="hpSettlement"
              value={target || null}
              onChange={(e) => setTarget((e.value as string | null) ?? "")}
              options={(payables?.settlements ?? []).map((s) => ({ label: `${s.number} — ${localizedName({ name: s.employeeName, nameAr: s.employeeNameAr }, i18n.language)} — ${formatMoney(s.amount, payables?.currency ?? "SAR")}`, value: s.settlementId }))}
              placeholder={t("hr.payments.pickSettlement")}
            />
          </div>
        ) : null}
        {kind === "GOSI" ? (
          <div className="erp-field">
            <label htmlFor="hpAmount">{t("payments.amount")}</label>
            <InputText id="hpAmount" dir="ltr" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <small className="erp-field__hint">{t("hr.payments.gosiHint", { amount: formatMoney(payables?.gosiOutstanding ?? "0", payables?.currency ?? "SAR") })}</small>
          </div>
        ) : null}
        <div className="erp-field">
          <label htmlFor="hpDate">{t("payments.date")}</label>
          <Calendar inputId="hpDate" value={date} onChange={(e) => setDate((e.value as Date | null) ?? new Date())} dateFormat="yy-mm-dd" />
        </div>
        <div className="erp-field">
          <label htmlFor="hpCash">{t("payments.bankAccount")}</label>
          <Dropdown
            inputId="hpCash"
            value={cash || null}
            onChange={(e) => setCash((e.value as string | null) ?? "")}
            options={banks.map((a) => ({ label: `${a.code} — ${localizedName(a, i18n.language)}`, value: a.id }))}
            filter
            placeholder={t("payments.pickBank")}
          />
        </div>
        {mutation.isError ? <p className="erp-auth-card__error">{t(`hr.payments.errors.${code ?? "generic"}`, { defaultValue: t("hr.payments.errors.generic") })}</p> : null}
        <div className="erp-form__actions">
          <Button type="button" label={t("actions.cancel")} text onClick={onHide} />
          <Button type="button" label={t("hr.payments.confirm")} disabled={!ready} loading={mutation.isPending} onClick={submit} />
        </div>
      </div>
    </Dialog>
  );
}
