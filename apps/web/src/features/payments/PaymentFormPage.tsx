import { DraftBar } from "../documents/DraftBar";
import { useDocumentDraft } from "../documents/use-document-draft";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "primereact/button";
import { Calendar } from "primereact/calendar";
import { Column } from "primereact/column";
import { DataTable } from "primereact/datatable";
import { Dropdown } from "primereact/dropdown";
import { InputText } from "primereact/inputtext";
import { Money, tafqeetAmount } from "@erp/shared";
import { useCurrentUser } from "../../shared/auth/use-current-user";
import { formatCalendarDate, toDateOnlyIsoString } from "../../shared/lib/format-date";
import { localizedName } from "../../shared/lib/localized-name";
import { formatMoney } from "../../shared/lib/money";
import { CreatedDialog, type CreatedInfo } from "../../shared/ui/CreatedDialog";
import { PartyPicker } from "../accounting/PartyPicker";
import { useChartOfAccounts } from "../accounting/use-chart-of-accounts";
import {
  PAYMENT_METHODS,
  useCreatePayment,
  useOpenInvoices,
  usePaymentCashAccounts,
  type OpenInvoice,
  type PaymentDirection,
  type PaymentMethod,
  type PaymentCounterpartyKind,
} from "./use-payments";
import { normalizePaymentAmount } from "./payment-amount";

const DECIMAL = /^\d{1,15}(\.\d{1,4})?$/;
const KNOWN_ERRORS = new Set(["OVER_ALLOCATED", "ALLOCATION_EXCEEDS_PAYMENT", "CASH_ACCOUNT_INVALID", "NO_OPEN_PERIOD", "INVOICE_NOT_FOUND", "DUPLICATE_ALLOCATION", "PARTY_KIND_INVALID", "COUNTER_ACCOUNT_INVALID", "ALLOCATION_NOT_ALLOWED"]);
const trim = (v: string): string => (v.includes(".") ? v.replace(/\.?0+$/, "") : v);

// Choose a party role or a ledger account for either direction. Customer receipts and supplier
// payments can settle invoices; their unallocated balance stays on account.
function PaymentForm({ direction }: { direction: PaymentDirection }): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { data: currentUser } = useCurrentUser();
  const currency = currentUser?.companyDefaultCurrency ?? "SAR";
  const { data: accounts } = useChartOfAccounts();
  const [created, setCreated] = useState<{ info: CreatedInfo } | null>(null);

  const [partyId, setPartyId] = useState(searchParams.get("party") ?? "");
  const [counterpartyKind, setCounterpartyKind] = useState<PaymentCounterpartyKind>(direction === "RECEIPT" ? "CUSTOMER" : "SUPPLIER");
  const [counterAccountId, setCounterAccountId] = useState("");
  const [date, setDate] = useState<Date>(new Date());
  const [amount, setAmount] = useState("");
  const [cashAccountId, setCashAccountId] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("BANK_TRANSFER");
  const [reference, setReference] = useState("");
  const [allocations, setAllocations] = useState<Record<string, string>>({});

  const draft = useDocumentDraft(direction === "RECEIPT" ? "customer_receipt" : "supplier_payment", { partyId, counterpartyKind, counterAccountId, date, amount, cashAccountId, method, reference, allocations }, (saved) => { setPartyId(saved.partyId); setCounterpartyKind(saved.counterpartyKind ?? (direction === "RECEIPT" ? "CUSTOMER" : "SUPPLIER")); setCounterAccountId(saved.counterAccountId ?? ""); setDate(saved.date); setAmount(saved.amount); setCashAccountId(saved.cashAccountId); setMethod(saved.method); setReference(saved.reference); setAllocations(saved.allocations); }, Boolean(partyId || counterAccountId || amount || reference || cashAccountId));
  const create = useCreatePayment(direction, draft.id);

  const canAllocate = (counterpartyKind === "CUSTOMER" && direction === "RECEIPT") || (counterpartyKind === "SUPPLIER" && direction === "PAYMENT");
  const { data: open, isFetching: invoicesLoading, isError: invoicesError } = useOpenInvoices(canAllocate ? partyId : "", direction);
  const { data: bankAccounts = [], isFetching: accountsLoading, isError: accountsError } = usePaymentCashAccounts(method);
  const counterAccounts = useMemo(() => (accounts ?? []).filter((a) => a.isActive && a.isPostable && a.id !== cashAccountId && (counterpartyKind === "ACCOUNT" || (partyId !== "" && a.partyId === partyId))), [accounts, counterpartyKind, partyId, cashAccountId]);

  const allocationValue = (id: string): string => allocations[id] ?? "";
  const allocationOk = (inv: OpenInvoice): boolean => {
    const v = allocationValue(inv.id);
    return v === "" || (DECIMAL.test(v) && Money.of(v, currency).compareTo(Money.of(inv.outstanding, currency)) <= 0);
  };
  const allocated = (open ?? []).reduce((sum, inv) => {
    const v = allocationValue(inv.id);
    return DECIMAL.test(v) ? sum.add(Money.of(v, currency)) : sum;
  }, Money.zero(currency));
  const paymentAmount = amount || (allocated.isPositive() ? trim(allocated.toDecimalString(4)) : "");
  const amountValid = DECIMAL.test(paymentAmount) && /[1-9]/.test(paymentAmount);
  const remaining = amountValid ? Money.of(paymentAmount, currency).subtract(allocated) : null;
  const needsCounterAccount = counterpartyKind === "ACCOUNT" || counterpartyKind === "EMPLOYEE";
  const valid = (counterpartyKind === "ACCOUNT" || partyId !== "") && (!needsCounterAccount || counterAccounts.some((a) => a.id === counterAccountId)) && bankAccounts.some((a) => a.id === cashAccountId) && amountValid && (!canAllocate || (!invoicesLoading && !invoicesError)) && (open ?? []).every(allocationOk) && remaining !== null && !remaining.isNegative();

  const edit = (change: () => void): void => {
    change();
    create.reset();
  };

  const fillOldestFirst = (): void => {
    if (!amountValid) return;
    let left = Money.of(paymentAmount, currency);
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

  const submit = async (): Promise<void> => {
    if (!valid) return;
    if (!await draft.save()) return;
    create.mutate(
      {
        ...(counterpartyKind !== "ACCOUNT" ? { partyId } : {}),
        counterpartyKind,
        ...(needsCounterAccount ? { counterAccountId } : {}),
        paymentDate: toDateOnlyIsoString(date),
        amount: paymentAmount,
        cashAccountId,
        method,
        ...(reference.trim() ? { reference: reference.trim() } : {}),
        allocations: Object.entries(canAllocate ? allocations : {})
          .filter(([id, v]) => open?.some((invoice) => invoice.id === id) && DECIMAL.test(v) && /[1-9]/.test(v))
          .map(([invoiceId, v]) => ({ invoiceId, amount: v })),
      },
      {
        onSuccess: (saved) => {
          void draft.complete();
          const account = accounts?.find((a) => a.id === cashAccountId);
          setCreated({
            info: {
              onOpen: () => void navigate(`/payments/${saved.id}`),
              title: t(`payments.${direction === "RECEIPT" ? "receipt" : "payment"}.title`),
              headline: saved.number,
              rows: [
                { label: t("payments.date"), value: toDateOnlyIsoString(date), ltr: true },
                { label: t("created.amount"), value: formatMoney(paymentAmount, currency), ltr: true },
                { label: t("created.inWords"), value: tafqeetAmount(paymentAmount, currency, i18n.language) },
                { label: t("created.method"), value: t(`payments.methods.${method}`) },
                { label: t("payments.bankAccount"), value: account ? `${account.code} — ${localizedName(account, i18n.language)}` : "" },
                { label: t("payments.allocated"), value: formatMoney(allocated.toDecimalString(4), currency), ltr: true },
                { label: t("payments.onAccount"), value: formatMoney(saved.unallocated, currency), ltr: true },
                { label: t("created.reference"), value: reference.trim() },
              ],
            },
          });
        },
      },
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

      <DraftBar draft={draft} />
      <div className="erp-form">
        <div className="erp-form__row">
          <div className="erp-field">
            <label htmlFor="payPartyKind">{t(`payments.${kind}.counterpartyType`)}</label>
            <Dropdown inputId="payPartyKind" value={counterpartyKind} options={(["CUSTOMER", "SUPPLIER", "EMPLOYEE", "ACCOUNT"] as const).map((value) => ({ value, label: t(`payments.counterpartyKinds.${value}`) }))} onChange={(e) => edit(() => { setCounterpartyKind(e.value as PaymentCounterpartyKind); setPartyId(""); setCounterAccountId(""); setAllocations({}); })} />
          </div>
          {counterpartyKind !== "ACCOUNT" ? <div className="erp-field">
            <label htmlFor="payParty">{t(`payments.counterpartyKinds.${counterpartyKind}`)}</label>
            <PartyPicker
              key={counterpartyKind}
              kind={counterpartyKind}
              inputId="payParty"
              value={partyId || null}
              onChange={(party) =>
                edit(() => {
                  setPartyId(party?.id ?? "");
                  setCounterAccountId("");
                  setAllocations({});
                })
              }
            />
          </div> : null}
          {needsCounterAccount ? <div className="erp-field">
            <label htmlFor="payCounterAccount">{t(counterpartyKind === "EMPLOYEE" ? "payments.employeeAccount" : "payments.counterpartyKinds.ACCOUNT")}</label>
            <Dropdown inputId="payCounterAccount" value={counterAccountId || null} options={counterAccounts.map((a) => ({ value: a.id, label: `${a.code} — ${localizedName(a, i18n.language)}` }))} filter showClear placeholder={t("payments.pickCounterAccount")} onChange={(e) => edit(() => setCounterAccountId((e.value as string | null) ?? ""))} />
            {counterpartyKind === "EMPLOYEE" ? <small className="erp-field__hint">{t("payments.employeeAccountHint")}</small> : null}
          </div> : null}
        </div>
        <div className="erp-form__row">
          <div className="erp-field">
            <label htmlFor="payDate">{t("payments.date")}</label>
            <Calendar inputId="payDate" value={date} onChange={(e) => e.value && setDate(e.value)} dateFormat="yy-mm-dd" />
          </div>
          <div className="erp-field">
            <label htmlFor="payAmount">{t("payments.amount")}</label>
            <InputText id="payAmount" dir="ltr" inputMode="decimal" value={paymentAmount} onChange={(e) => edit(() => setAmount(normalizePaymentAmount(e.target.value)))} className={paymentAmount !== "" && !amountValid ? "p-invalid" : ""} />
            {canAllocate ? <small className="erp-field__hint">{t("payments.amountFromAllocations")}</small> : null}
          </div>
        </div>
        <div className="erp-form__row">
          <div className="erp-field">
            <label htmlFor="payMethod">{t("payments.method")}</label>
            <Dropdown inputId="payMethod" value={method} onChange={(e) => edit(() => { setMethod(e.value as PaymentMethod); setCashAccountId(""); })} options={PAYMENT_METHODS.map((m) => ({ label: t(`payments.methods.${m}`), value: m }))} />
          </div>
          <div className="erp-field">
            <label htmlFor="payBank">{t(method === "CASH" ? "payments.cashAccount" : "payments.bankOnly")}</label>
            <Dropdown
              inputId="payBank"
              value={cashAccountId || null}
              onChange={(e) => edit(() => setCashAccountId((e.value as string | null) ?? ""))}
              options={bankAccounts.map((a) => ({ label: `${a.code} — ${localizedName(a, i18n.language)}`, value: a.id }))}
              filter
              placeholder={t(method === "CASH" ? "payments.pickCash" : "payments.pickBank")}
              loading={accountsLoading}
              emptyMessage={t("payments.noCashAccounts")}
            />
            {!accountsLoading && bankAccounts.length === 0 ? <small className="erp-field__hint">{t(accountsError ? "status.error" : "payments.noCashAccounts")}</small> : null}
          </div>
          <div className="erp-field">
            <label htmlFor="payRef">{t("payments.reference")}</label>
            <InputText id="payRef" value={reference} onChange={(e) => setReference(e.target.value)} />
          </div>
        </div>

        {partyId && canAllocate ? (
          <>
            <div className="erp-row-actions">
              <h3 className="erp-form__section-title">{t("payments.settle")}</h3>
              <Button type="button" label={t("payments.fillOldest")} icon="pi pi-sort-amount-down" text disabled={!amountValid || (open ?? []).length === 0} onClick={fillOldestFirst} />
            </div>
            {invoicesError ? <p className="erp-auth-card__error">{t("status.error")}</p> : null}
            {/* Allocation values live outside rowData; memoized cells would retain the old input value. */}
            <DataTable value={[...(open ?? [])]} dataKey="id" cellMemo={false} loading={invoicesLoading} className="erp-table" size="small" showGridlines emptyMessage={t("payments.noOpenInvoices")}>
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
                    inputMode="decimal"
                    aria-label={`${t("payments.settleNow")} ${i.number}`}
                    placeholder="0.00"
                    value={allocationValue(i.id)}
                    onChange={(e) => {
                      const value = normalizePaymentAmount(e.target.value);
                      edit(() => setAllocations((prev) => ({ ...prev, [i.id]: value })));
                    }}
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
          <Button type="button" label={t(`payments.${kind}.submit`)} icon="pi pi-check" disabled={!valid || !draft.ready || draft.status === "completed"} loading={create.isPending} onClick={() => { void submit(); }} />
        </div>
      </div>
      <CreatedDialog info={created?.info ?? null} onHide={() => void navigate("/payments")} />
    </div>
  );
}

export const CustomerReceiptPage = (): React.JSX.Element => <PaymentForm direction="RECEIPT" />;
export const SupplierPaymentPage = (): React.JSX.Element => <PaymentForm direction="PAYMENT" />;
