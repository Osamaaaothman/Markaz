import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Button } from "primereact/button";
import { Calendar } from "primereact/calendar";
import { Column } from "primereact/column";
import { DataTable } from "primereact/datatable";
import { Dropdown } from "primereact/dropdown";
import { InputText } from "primereact/inputtext";
import { Money } from "@erp/shared";
import { useCurrentUser } from "../../shared/auth/use-current-user";
import { formatCalendarDate, toDateOnlyIsoString } from "../../shared/lib/format-date";
import { localizedName } from "../../shared/lib/localized-name";
import { formatMoney } from "../../shared/lib/money";
import { PartyPicker } from "../accounting/PartyPicker";
import { useChartOfAccounts } from "../accounting/use-chart-of-accounts";
import {
  PAYMENT_METHODS,
  useCreatePayment,
  useOpenInvoices,
  type OpenInvoice,
  type PaymentDirection,
  type PaymentMethod,
} from "./use-payments";

const DECIMAL = /^\d{1,15}(\.\d{1,4})?$/;
const KNOWN_ERRORS = new Set(["OVER_ALLOCATED", "ALLOCATION_EXCEEDS_PAYMENT", "CASH_ACCOUNT_INVALID", "NO_OPEN_PERIOD", "INVOICE_NOT_FOUND", "DUPLICATE_ALLOCATION"]);
const trim = (v: string): string => (v.includes(".") ? v.replace(/\.?0+$/, "") : v);

// Money in from a customer, or money out to a supplier. Pick the party, the bank account and the
// amount, then say which open invoices it settles ("Fill oldest first" does it for you). Whatever is
// not allocated stays on account for the party.
function PaymentForm({ direction }: { direction: PaymentDirection }): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { data: currentUser } = useCurrentUser();
  const currency = currentUser?.companyDefaultCurrency ?? "SAR";
  const { data: accounts } = useChartOfAccounts();
  const create = useCreatePayment(direction);

  const [partyId, setPartyId] = useState("");
  const [date, setDate] = useState<Date>(new Date());
  const [amount, setAmount] = useState("");
  const [cashAccountId, setCashAccountId] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("BANK_TRANSFER");
  const [reference, setReference] = useState("");
  const [allocations, setAllocations] = useState<Record<string, string>>({});

  const { data: open } = useOpenInvoices(partyId, direction);
  const bankAccounts = useMemo(() => (accounts ?? []).filter((a) => a.isPostable && a.type === "ASSET"), [accounts]);

  const amountValid = DECIMAL.test(amount) && /[1-9]/.test(amount);
  const allocationValue = (id: string): string => allocations[id] ?? "";
  const allocationOk = (inv: OpenInvoice): boolean => {
    const v = allocationValue(inv.id);
    return v === "" || (DECIMAL.test(v) && Money.of(v, currency).compareTo(Money.of(inv.outstanding, currency)) <= 0);
  };
  const allocated = (open ?? []).reduce((sum, inv) => {
    const v = allocationValue(inv.id);
    return DECIMAL.test(v) ? sum.add(Money.of(v, currency)) : sum;
  }, Money.zero(currency));
  const remaining = amountValid ? Money.of(amount, currency).subtract(allocated) : null;
  const valid = partyId !== "" && cashAccountId !== "" && amountValid && (open ?? []).every(allocationOk) && remaining !== null && !remaining.isNegative();

  const edit = (change: () => void): void => {
    change();
    create.reset();
  };

  const fillOldestFirst = (): void => {
    if (!amountValid) return;
    let left = Money.of(amount, currency);
    const next: Record<string, string> = {};
    for (const inv of [...(open ?? [])].sort((a, b) => a.invoiceDate.localeCompare(b.invoiceDate))) {
      if (!left.isPositive()) break;
      const owed = Money.of(inv.outstanding, currency);
      const take = left.compareTo(owed) < 0 ? left : owed;
      next[inv.id] = trim(take.toDecimalString(4));
      left = left.subtract(take);
    }
    edit(() => setAllocations(next));
  };

  const submit = (): void => {
    create.mutate(
      {
        partyId,
        paymentDate: toDateOnlyIsoString(date),
        amount,
        cashAccountId,
        method,
        ...(reference.trim() ? { reference: reference.trim() } : {}),
        allocations: Object.entries(allocations)
          .filter(([, v]) => DECIMAL.test(v) && /[1-9]/.test(v))
          .map(([invoiceId, v]) => ({ invoiceId, amount: v })),
      },
      { onSuccess: () => void navigate("/payments") },
    );
  };

  const err = (create.error as { response?: { status?: number; data?: { error?: { code?: string } } } } | null)?.response;
  const errCode = err?.data?.error?.code;
  const errKey = create.isError ? (errCode && KNOWN_ERRORS.has(errCode) ? `payments.errors.${errCode}` : err?.status === 400 ? "payments.errors.badRequest" : "payments.errors.generic") : null;
  const kind = direction === "RECEIPT" ? "receipt" : "payment";

  return (
    <div className="erp-page erp-page--wide">
      <div className="erp-page__header">
        <div>
          <h1 className="erp-page__title">{t(`payments.${kind}.title`)}</h1>
          <p className="erp-page__subtitle">{t(`payments.${kind}.subtitle`)}</p>
        </div>
      </div>

      <div className="erp-form">
        <div className="erp-form__row">
          <div className="erp-field">
            <label htmlFor="payParty">{t(`payments.${kind}.party`)}</label>
            <PartyPicker
              inputId="payParty"
              value={partyId || null}
              onChange={(party) =>
                edit(() => {
                  setPartyId(party?.id ?? "");
                  setAllocations({});
                })
              }
            />
          </div>
          <div className="erp-field">
            <label htmlFor="payDate">{t("payments.date")}</label>
            <Calendar inputId="payDate" value={date} onChange={(e) => e.value && setDate(e.value)} dateFormat="yy-mm-dd" />
          </div>
          <div className="erp-field">
            <label htmlFor="payAmount">{t("payments.amount")}</label>
            <InputText id="payAmount" dir="ltr" value={amount} onChange={(e) => edit(() => setAmount(e.target.value))} className={amount !== "" && !amountValid ? "p-invalid" : ""} />
          </div>
        </div>
        <div className="erp-form__row">
          <div className="erp-field">
            <label htmlFor="payBank">{t("payments.bankAccount")}</label>
            <Dropdown
              inputId="payBank"
              value={cashAccountId || null}
              onChange={(e) => edit(() => setCashAccountId((e.value as string | null) ?? ""))}
              options={bankAccounts.map((a) => ({ label: `${a.code} — ${localizedName(a, i18n.language)}`, value: a.id }))}
              filter
              placeholder={t("payments.pickBank")}
            />
          </div>
          <div className="erp-field">
            <label htmlFor="payMethod">{t("payments.method")}</label>
            <Dropdown inputId="payMethod" value={method} onChange={(e) => setMethod(e.value as PaymentMethod)} options={PAYMENT_METHODS.map((m) => ({ label: t(`payments.methods.${m}`), value: m }))} />
          </div>
          <div className="erp-field">
            <label htmlFor="payRef">{t("payments.reference")}</label>
            <InputText id="payRef" value={reference} onChange={(e) => setReference(e.target.value)} />
          </div>
        </div>

        {partyId ? (
          <>
            <div className="erp-row-actions">
              <h3 className="erp-form__section-title">{t("payments.settle")}</h3>
              <Button type="button" label={t("payments.fillOldest")} icon="pi pi-sort-amount-down" text disabled={!amountValid || (open ?? []).length === 0} onClick={fillOldestFirst} />
            </div>
            <DataTable value={[...(open ?? [])]} className="erp-table" size="small" showGridlines emptyMessage={t("payments.noOpenInvoices")}>
              <Column header={t("purchasing.number")} style={{ width: "13rem" }} body={(i: OpenInvoice) => <span className="coa-code">{i.number}</span>} />
              <Column header={t("purchasing.invoices.invoiceDate")} style={{ width: "9rem" }} body={(i: OpenInvoice) => formatCalendarDate(i.invoiceDate, i18n.language)} />
              <Column header={t("purchasing.invoices.dueDate")} style={{ width: "9rem" }} body={(i: OpenInvoice) => (i.dueDate ? formatCalendarDate(i.dueDate, i18n.language) : "")} />
              <Column header={t("purchasing.invoices.gross")} align="right" body={(i: OpenInvoice) => formatMoney(i.gross, i.currency)} />
              <Column header={t("payments.outstanding")} align="right" body={(i: OpenInvoice) => formatMoney(i.outstanding, i.currency)} />
              <Column
                header={t("payments.settleNow")}
                style={{ width: "11rem" }}
                body={(i: OpenInvoice) => (
                  <InputText
                    dir="ltr"
                    value={allocationValue(i.id)}
                    onChange={(e) => edit(() => setAllocations((prev) => ({ ...prev, [i.id]: e.target.value })))}
                    className={allocationOk(i) ? "" : "p-invalid"}
                  />
                )}
              />
            </DataTable>
            <div className="erp-table-footer">
              <span>
                {t("payments.allocated")}: <strong>{formatMoney(allocated.toDecimalString(4), currency)}</strong>
              </span>
              <span>
                {t("payments.onAccount")}: <strong>{remaining ? formatMoney(remaining.toDecimalString(4), currency) : "—"}</strong>
              </span>
            </div>
            {remaining?.isNegative() ? <p className="erp-auth-card__error">{t("payments.errors.ALLOCATION_EXCEEDS_PAYMENT")}</p> : null}
          </>
        ) : null}

        {errKey ? <p className="erp-auth-card__error">{t(errKey)}</p> : null}
        <div className="erp-form__actions">
          <Button type="button" label={t("actions.cancel")} text onClick={() => void navigate("/payments")} />
          <Button type="button" label={t(`payments.${kind}.submit`)} icon="pi pi-check" disabled={!valid} loading={create.isPending} onClick={submit} />
        </div>
      </div>
    </div>
  );
}

export const CustomerReceiptPage = (): React.JSX.Element => <PaymentForm direction="RECEIPT" />;
export const SupplierPaymentPage = (): React.JSX.Element => <PaymentForm direction="PAYMENT" />;
