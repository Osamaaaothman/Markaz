import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Button } from "primereact/button";
import { Column } from "primereact/column";
import { DataTable } from "primereact/datatable";
import { InputText } from "primereact/inputtext";
import { Money } from "@erp/shared";
import { useCurrentUser } from "../../shared/auth/use-current-user";
import { formatCalendarDate } from "../../shared/lib/format-date";
import { formatMoney } from "../../shared/lib/money";
import { PartyPicker } from "../accounting/PartyPicker";
import { usePartyBalance, useSettle, type OpenInvoice, type PaymentDirection } from "./use-payments";

const DECIMAL = /^\d{1,15}(\.\d{1,4})?$/;

// Ties money already on account (an old receipt/payment bigger than what it settled at the time, or
// one deliberately left unallocated) to invoices that are open now. Nothing is posted here — the cash
// already moved and was already booked; this only records which invoice(s) it now covers.
function SettleForm({ direction }: { direction: PaymentDirection }): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { data: currentUser } = useCurrentUser();
  const currency = currentUser?.companyDefaultCurrency ?? "SAR";
  const settle = useSettle();

  const [partyId, setPartyId] = useState("");
  const [allocations, setAllocations] = useState<Record<string, string>>({});
  const { data: balance, isPending } = usePartyBalance(partyId, direction);

  const allocationValue = (id: string): string => allocations[id] ?? "";
  const allocationOk = (inv: OpenInvoice): boolean => {
    const v = allocationValue(inv.id);
    return v === "" || (DECIMAL.test(v) && Money.of(v, currency).compareTo(Money.of(inv.outstanding, currency)) <= 0);
  };
  const totalUnallocated = balance ? Money.of(balance.totalUnallocated, currency) : Money.zero(currency);
  const allocated = (balance?.openInvoices ?? []).reduce((sum, inv) => {
    const v = allocationValue(inv.id);
    return DECIMAL.test(v) ? sum.add(Money.of(v, currency)) : sum;
  }, Money.zero(currency));
  const remaining = totalUnallocated.subtract(allocated);
  const valid = partyId !== "" && allocated.isPositive() && !remaining.isNegative() && (balance?.openInvoices ?? []).every(allocationOk);

  const edit = (change: () => void): void => {
    change();
    settle.reset();
  };

  const fillOldestFirst = (): void => {
    if (!balance) return;
    let left = totalUnallocated;
    const next: Record<string, string> = {};
    for (const inv of [...balance.openInvoices].sort((a, b) => a.invoiceDate.localeCompare(b.invoiceDate))) {
      if (!left.isPositive()) break;
      const owed = Money.of(inv.outstanding, currency);
      const take = left.compareTo(owed) < 0 ? left : owed;
      next[inv.id] = take.toDecimalString(4).replace(/\.?0+$/, "");
      left = left.subtract(take);
    }
    edit(() => setAllocations(next));
  };

  const submit = (): void => {
    settle.mutate(
      {
        partyId,
        direction,
        allocations: Object.entries(allocations)
          .filter(([, v]) => DECIMAL.test(v) && /[1-9]/.test(v))
          .map(([invoiceId, v]) => ({ invoiceId, amount: v })),
      },
      { onSuccess: () => setAllocations({}) },
    );
  };

  const err = (settle.error as { response?: { status?: number; data?: { error?: { code?: string } } } } | null)?.response;
  const errCode = err?.data?.error?.code;
  const kind = direction === "RECEIPT" ? "receipt" : "payment";

  return (
    <div className="erp-page erp-page--wide">
      <div className="erp-page__header">
        <div>
          <h1 className="erp-page__title">{t("payments.settleBalance.title")}</h1>
          <p className="erp-page__subtitle">{t(`payments.settleBalance.subtitle.${kind}`)}</p>
        </div>
      </div>

      <div className="erp-form">
        <div className="erp-field">
          <label htmlFor="setParty">{t(`payments.${kind}.party`)}</label>
          <PartyPicker
            inputId="setParty"
            value={partyId || null}
            onChange={(party) =>
              edit(() => {
                setPartyId(party?.id ?? "");
                setAllocations({});
              })
            }
          />
        </div>

        {partyId && !isPending && balance ? (
          <>
            <div className="erp-table-footer">
              <span>
                {t("payments.settleBalance.available")}: <strong>{formatMoney(balance.totalUnallocated, currency)}</strong>
              </span>
            </div>

            {balance.unallocatedPayments.length > 0 ? (
              <DataTable value={[...balance.unallocatedPayments]} className="erp-table" size="small" showGridlines>
                <Column header={t("purchasing.number")} body={(p) => <span className="coa-code">{p.number}</span>} />
                <Column header={t("payments.date")} body={(p) => formatCalendarDate(p.paymentDate, i18n.language)} />
                <Column header={t("payments.method")} body={(p) => t(`payments.methods.${p.method}`)} />
                <Column header={t("payments.onAccount")} align="right" body={(p) => formatMoney(p.unallocated, currency)} />
              </DataTable>
            ) : (
              <p className="erp-card__empty">{t("payments.settleBalance.noBalance")}</p>
            )}

            <div className="erp-row-actions">
              <h3 className="erp-form__section-title">{t("payments.settle")}</h3>
              <Button type="button" label={t("payments.fillOldest")} icon="pi pi-sort-amount-down" text disabled={!totalUnallocated.isPositive() || balance.openInvoices.length === 0} onClick={fillOldestFirst} />
            </div>
            <DataTable value={[...balance.openInvoices]} className="erp-table" size="small" showGridlines emptyMessage={t("payments.noOpenInvoices")}>
              <Column header={t("purchasing.number")} style={{ width: "13rem" }} body={(i: OpenInvoice) => <span className="coa-code">{i.number}</span>} />
              <Column header={t("purchasing.invoices.invoiceDate")} style={{ width: "9rem" }} body={(i: OpenInvoice) => formatCalendarDate(i.invoiceDate, i18n.language)} />
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
                {t("payments.settleBalance.left")}: <strong>{formatMoney(remaining.toDecimalString(4), currency)}</strong>
              </span>
            </div>
            {remaining.isNegative() ? <p className="erp-auth-card__error">{t("payments.errors.ALLOCATION_EXCEEDS_PAYMENT")}</p> : null}
          </>
        ) : null}

        {settle.isError ? <p className="erp-auth-card__error">{t(errCode === "INSUFFICIENT_BALANCE" ? "payments.settleBalance.errors.INSUFFICIENT_BALANCE" : "payments.errors.generic")}</p> : null}
        {settle.isSuccess ? <p className="erp-field__hint">{t("payments.settleBalance.success")}</p> : null}

        <div className="erp-form__actions">
          <Button type="button" label={t("actions.cancel")} text onClick={() => void navigate("/payments/receipts")} />
          <Button type="button" label={t("payments.settle")} icon="pi pi-check" disabled={!valid} loading={settle.isPending} onClick={submit} />
        </div>
      </div>
    </div>
  );
}

export const SettleReceiptsPage = (): React.JSX.Element => <SettleForm direction="RECEIPT" />;
export const SettleSupplierPage = (): React.JSX.Element => <SettleForm direction="PAYMENT" />;
