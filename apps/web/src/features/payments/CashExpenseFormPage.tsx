import { useDocumentDraft } from "../documents/use-document-draft";
import { DraftBar } from "../documents/DraftBar";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Button } from "primereact/button";
import { Calendar } from "primereact/calendar";
import { Dropdown } from "primereact/dropdown";
import { InputText } from "primereact/inputtext";
import { tafqeetAmount } from "@erp/shared";
import { useCurrentUser } from "../../shared/auth/use-current-user";
import { toDateOnlyIsoString } from "../../shared/lib/format-date";
import { localizedName } from "../../shared/lib/localized-name";
import { formatMoney } from "../../shared/lib/money";
import { useChartOfAccounts } from "../accounting/use-chart-of-accounts";
import { CreatedDialog, type CreatedInfo } from "../../shared/ui/CreatedDialog";
import { useCreateCashExpense } from "./use-cash-expenses";

const DECIMAL = /^\d{1,15}(\.\d{1,4})?$/;
const KNOWN_ERRORS = new Set(["CASH_ACCOUNT_NOT_FOUND", "CASH_ACCOUNT_INVALID", "EXPENSE_ACCOUNT_NOT_FOUND", "EXPENSE_ACCOUNT_INVALID", "NO_OPEN_PERIOD"]);

// A small cash outlay straight to an expense: no supplier, no invoice. Pick where the money came
// from (petty cash or a bank account) and what it was spent on.
export function CashExpenseFormPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { data: currentUser } = useCurrentUser();
  const currency = currentUser?.companyDefaultCurrency ?? "SAR";
  const { data: accounts } = useChartOfAccounts();

  const [created, setCreated] = useState<CreatedInfo | null>(null);

  const [date, setDate] = useState<Date>(new Date());
  const [amount, setAmount] = useState("");
  const [cashAccountId, setCashAccountId] = useState("");
  const [expenseAccountId, setExpenseAccountId] = useState("");
  const [description, setDescription] = useState("");
  const [reference, setReference] = useState("");
  const draft = useDocumentDraft("cash_expense", { date, amount, cashAccountId, expenseAccountId, description, reference }, (saved) => { setDate(saved.date); setAmount(saved.amount); setCashAccountId(saved.cashAccountId); setExpenseAccountId(saved.expenseAccountId); setDescription(saved.description); setReference(saved.reference); }, amount !== "" || description !== "" || cashAccountId !== "");
  const create = useCreateCashExpense(draft.id);

  const cashAccounts = useMemo(() => (accounts ?? []).filter((a) => a.isPostable && a.type === "ASSET"), [accounts]);
  const expenseAccounts = useMemo(() => (accounts ?? []).filter((a) => a.isPostable && a.type === "EXPENSE"), [accounts]);

  const amountValid = DECIMAL.test(amount) && /[1-9]/.test(amount);
  const valid = amountValid && cashAccountId !== "" && expenseAccountId !== "";

  const edit = (change: () => void): void => {
    change();
    create.reset();
  };

  const submit = async (): Promise<void> => {
    if (!valid || !draft.ready || !await draft.save()) return;
    create.mutate(
      {
        expenseDate: toDateOnlyIsoString(date),
        amount,
        cashAccountId,
        expenseAccountId,
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(reference.trim() ? { reference: reference.trim() } : {}),
      },
      {
        onSuccess: (saved) => {
          void draft.complete();
          const cash = accounts?.find((a) => a.id === cashAccountId);
          const expense = accounts?.find((a) => a.id === expenseAccountId);
          setCreated({
            onOpen: () => void navigate("/payments/cash-expenses"),
            title: t("cashExpenses.title"),
            headline: saved.number,
            rows: [
              { label: t("cashExpenses.date"), value: toDateOnlyIsoString(date), ltr: true },
              { label: t("created.amount"), value: formatMoney(amount, currency), ltr: true },
              { label: t("created.inWords"), value: tafqeetAmount(amount, currency) },
              { label: t("cashExpenses.cashAccount"), value: cash ? `${cash.code} — ${localizedName(cash, i18n.language)}` : "" },
              { label: t("cashExpenses.expenseAccount"), value: expense ? `${expense.code} — ${localizedName(expense, i18n.language)}` : "" },
              { label: t("created.reference"), value: reference.trim() },
            ],
          });
        },
      },
    );
  };

  const err = (create.error as { response?: { status?: number; data?: { error?: { code?: string } } } } | null)?.response;
  const errCode = err?.data?.error?.code;
  const errKey = create.isError ? (errCode && KNOWN_ERRORS.has(errCode) ? `cashExpenses.errors.${errCode}` : "cashExpenses.errors.generic") : null;

  return (
    <div className="erp-page">
      <div className="erp-page__header">
        <div>
          <h1 className="erp-page__title">{t("cashExpenses.newTitle")}</h1>
          <p className="erp-page__subtitle">{t("cashExpenses.newSubtitle")}</p>
        </div>
      </div>

      <DraftBar draft={draft} />
      <div className="erp-form">
        <div className="erp-form__row">
          <div className="erp-field">
            <label htmlFor="cexDate">{t("cashExpenses.date")}</label>
            <Calendar inputId="cexDate" value={date} onChange={(e) => e.value && edit(() => setDate(e.value as Date))} dateFormat="yy-mm-dd" />
          </div>
          <div className="erp-field">
            <label htmlFor="cexAmount">{t("payments.amount")}</label>
            <InputText id="cexAmount" dir="ltr" value={amount} onChange={(e) => edit(() => setAmount(e.target.value))} className={amount !== "" && !amountValid ? "p-invalid" : ""} />
          </div>
          <div className="erp-field">
            <label htmlFor="cexRef">{t("payments.reference")}</label>
            <InputText id="cexRef" value={reference} onChange={(e) => setReference(e.target.value)} />
          </div>
        </div>
        <div className="erp-form__row">
          <div className="erp-field">
            <label htmlFor="cexCash">{t("cashExpenses.cashAccount")}</label>
            <Dropdown
              inputId="cexCash"
              value={cashAccountId || null}
              onChange={(e) => edit(() => setCashAccountId((e.value as string | null) ?? ""))}
              options={cashAccounts.map((a) => ({ label: `${a.code} — ${localizedName(a, i18n.language)}`, value: a.id }))}
              filter
              placeholder={t("payments.pickBank")}
            />
          </div>
          <div className="erp-field">
            <label htmlFor="cexExpense">{t("cashExpenses.expenseAccount")}</label>
            <Dropdown
              inputId="cexExpense"
              value={expenseAccountId || null}
              onChange={(e) => edit(() => setExpenseAccountId((e.value as string | null) ?? ""))}
              options={expenseAccounts.map((a) => ({ label: `${a.code} — ${localizedName(a, i18n.language)}`, value: a.id }))}
              filter
              placeholder={t("cashExpenses.pickExpenseAccount")}
            />
          </div>
        </div>
        <div className="erp-field">
          <label htmlFor="cexDesc">{t("cashExpenses.description")}</label>
          <InputText id="cexDesc" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>

        {errKey ? <p className="erp-auth-card__error">{t(errKey)}</p> : null}
        <div className="erp-form__actions">
          <Button type="button" label={t("actions.cancel")} text onClick={() => void navigate("/payments/cash-expenses")} />
          <Button type="button" label={t("actions.save")} icon="pi pi-check" disabled={!valid || !draft.ready || created !== null} loading={create.isPending} onClick={() => { void submit(); }} />
        </div>
      </div>
      <CreatedDialog info={created} onHide={() => void navigate("/payments/cash-expenses")} />
    </div>
  );
}
