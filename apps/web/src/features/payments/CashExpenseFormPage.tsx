import { useDocumentDraft } from "../documents/use-document-draft";
import { DraftBar } from "../documents/DraftBar";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Button } from "primereact/button";
import { Calendar } from "primereact/calendar";
import { Dropdown } from "primereact/dropdown";
import { InputText } from "primereact/inputtext";
import { Money, tafqeetAmount } from "@erp/shared";
import { useCostCenters } from "./use-cost-centers";
import { CostCentersDialog } from "./CostCentersDialog";
import { normalizePaymentAmount } from "./payment-amount";
import { useCurrentUser } from "../../shared/auth/use-current-user";
import { toDateOnlyIsoString } from "../../shared/lib/format-date";
import { localizedName } from "../../shared/lib/localized-name";
import { formatMoney } from "../../shared/lib/money";
import { useChartOfAccounts } from "../accounting/use-chart-of-accounts";
import { CreatedDialog, type CreatedInfo } from "../../shared/ui/CreatedDialog";
import { LineField } from "../../shared/ui/LineField";
import { useCreateCashExpense } from "./use-cash-expenses";
import { usePaymentCashAccounts } from "./use-payments";

const DECIMAL = /^\d{1,15}(\.\d{1,4})?$/;
const KNOWN_ERRORS = new Set([
  "CASH_ACCOUNT_NOT_FOUND",
  "CASH_ACCOUNT_INVALID",
  "EXPENSE_ACCOUNT_NOT_FOUND",
  "EXPENSE_ACCOUNT_INVALID",
  "NO_OPEN_PERIOD",
  "LINES_EMPTY",
  "COST_CENTER_INVALID",
]);

// One expense line being filled in: which expense account, how much, and where it belongs (cost center).
interface CashExpenseLineDraft {
  id: string;
  expenseAccountId: string;
  amount: string;
  costCenterRef: string;
  costCenterId: string;
  description: string;
}

const emptyLine = (): CashExpenseLineDraft => ({
  id: crypto.randomUUID(),
  expenseAccountId: "",
  amount: "",
  costCenterRef: "",
  costCenterId: "",
  description: "",
});

const lineHasInput = (line: CashExpenseLineDraft): boolean =>
  line.expenseAccountId !== "" || line.amount !== "" || line.costCenterRef !== "" || line.costCenterId !== "" || line.description !== "";

const lineValid = (line: CashExpenseLineDraft): boolean =>
  line.expenseAccountId !== "" && DECIMAL.test(line.amount) && /[1-9]/.test(line.amount);

// A small cash outlay straight to an expense: no supplier, no invoice. Pick where the money came
// from (a cash box) and split it over one or more expense lines, each with its own cost center.
export function CashExpenseFormPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { data: currentUser } = useCurrentUser();
  const currency = currentUser?.companyDefaultCurrency ?? "SAR";
  const { data: accounts } = useChartOfAccounts();
  const centers = useCostCenters();
  const [showCenters, setShowCenters] = useState(false);

  const [created, setCreated] = useState<CreatedInfo | null>(null);

  const [date, setDate] = useState<Date>(new Date());
  const [cashAccountId, setCashAccountId] = useState("");
  const [lines, setLines] = useState<CashExpenseLineDraft[]>([emptyLine()]);
  const [description, setDescription] = useState("");
  const [reference, setReference] = useState("");
  const draft = useDocumentDraft(
    "cash_expense",
    { date, cashAccountId, lines, description, reference },
    (saved) => {
      setDate(saved.date);
      setCashAccountId(saved.cashAccountId);
      setLines(saved.lines?.length ? saved.lines.map((line) => ({ ...line, costCenterId: line.costCenterId ?? "" })) : [emptyLine()]);
      setDescription(saved.description);
      setReference(saved.reference);
    },
    cashAccountId !== "" || description !== "" || lines.some(lineHasInput),
  );
  const create = useCreateCashExpense(draft.id);

  const { data: cashAccounts = [], isFetching: cashAccountsLoading, isError: cashAccountsError } = usePaymentCashAccounts("CASH");
  const expenseAccounts = useMemo(() => (accounts ?? []).filter((a) => a.isPostable && a.type === "EXPENSE"), [accounts]);

  const expenseOptions = useMemo(
    () => expenseAccounts.map((a) => ({ label: `${a.code} — ${localizedName(a, i18n.language)}`, value: a.id })),
    [expenseAccounts, i18n.language],
  );

  const total = lines.reduce((sum, line) => DECIMAL.test(line.amount) ? sum.add(Money.of(line.amount, currency)) : sum, Money.zero(currency)).toDecimalString(4);
  const showTotal = lines.some((l) => l.amount !== "" && DECIMAL.test(l.amount) && /[1-9]/.test(l.amount));

  const valid = !cashAccountsLoading && !cashAccountsError && cashAccounts.some((a) => a.id === cashAccountId) && lines.length > 0 && lines.every((line) => lineValid(line) && (!line.costCenterId || centers.data?.some((center) => center.id === line.costCenterId && center.isActive)));

  const edit = (change: () => void): void => {
    change();
    create.reset();
  };

  const replaceLine = (next: CashExpenseLineDraft): void => {
    edit(() => setLines((previous) => previous.map((l) => (l.id === next.id ? next : l))));
  };

  const removeLine = (id: string): void => {
    edit(() => setLines((previous) => previous.filter((l) => l.id !== id)));
  };

  const addLine = (): void => {
    edit(() => setLines((previous) => [...previous, emptyLine()]));
  };

  const submit = async (): Promise<void> => {
    if (!valid || !draft.ready || !await draft.save()) return;
    create.mutate(
      {
        expenseDate: toDateOnlyIsoString(date),
        cashAccountId,
        lines: lines.map((l) => ({
          expenseAccountId: l.expenseAccountId,
          amount: l.amount,
          ...(l.costCenterId ? { costCenterId: l.costCenterId } : l.costCenterRef.trim() ? { costCenterRef: l.costCenterRef.trim() } : {}),
          ...(l.description.trim() ? { description: l.description.trim() } : {}),
        })),
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(reference.trim() ? { reference: reference.trim() } : {}),
      },
      {
        onSuccess: (saved) => {
          void draft.complete();
          const cash = accounts?.find((a) => a.id === cashAccountId);
          setCreated({
            onOpen: () => void navigate("/payments/cash-expenses"),
            title: t("cashExpenses.title"),
            headline: saved.number,
            rows: [
              { label: t("cashExpenses.date"), value: toDateOnlyIsoString(date), ltr: true },
              { label: t("created.amount"), value: formatMoney(total, currency), ltr: true },
              { label: t("created.inWords"), value: tafqeetAmount(total, currency, i18n.language) },
              { label: t("cashExpenses.cashAccount"), value: cash ? `${cash.code} — ${localizedName(cash, i18n.language)}` : "" },
              { label: t("cashExpenses.lines"), value: String(lines.length) },
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
              placeholder={t("payments.pickCash")}
              loading={cashAccountsLoading}
              emptyMessage={t("payments.noCashAccounts")}
            />
            {!cashAccountsLoading && (cashAccountsError || cashAccounts.length === 0) ? <small className="erp-field__hint">{t(cashAccountsError ? "status.error" : "payments.noCashAccounts")}</small> : null}
          </div>
        </div>
        <div className="erp-field">
          <label htmlFor="cexDesc">{t("cashExpenses.description")}</label>
          <InputText id="cexDesc" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>

        <h3 className="erp-form__section-title">{t("cashExpenses.lines")}</h3>
        <Button type="button" label={t("costCenters.title")} icon="pi pi-list" text onClick={() => setShowCenters(true)} />
        {centers.isError ? <p role="alert">{t("status.error")} <Button type="button" label={t("actions.retry")} text onClick={() => void centers.refetch()} /></p> : null}
        <div className="erp-lines">
          {lines.map((line) => (
            <div key={line.id} className="erp-lines__row">
              <LineField label={t("cashExpenses.expenseAccount")}>
                <Dropdown
                  value={line.expenseAccountId || null}
                  onChange={(e) => replaceLine({ ...line, expenseAccountId: (e.value as string | null) ?? "" })}
                  options={expenseOptions}
                  filter
                  placeholder={t("cashExpenses.pickExpenseAccount")}
                  className="erp-lines__account"
                />
              </LineField>
              <LineField label={t("cashExpenses.costCenter")} hint={line.costCenterRef && !line.costCenterId ? `${t("costCenters.legacy")}: ${line.costCenterRef}` : undefined}>
                <Dropdown
                  value={line.costCenterId || null}
                  onChange={(e) => replaceLine({ ...line, costCenterId: (e.value as string | null) ?? "", costCenterRef: "" })}
                  options={(centers.data ?? []).filter((center) => center.isActive || center.id === line.costCenterId).map((center) => ({ value: center.id, label: `${center.code} — ${localizedName(center, i18n.language)} (${t(`costCenters.kinds.${center.kind}`)})`, disabled: !center.isActive }))}
                  loading={centers.isPending}
                  filter showClear
                  placeholder={t("costCenters.pick")}
                  emptyMessage={t("costCenters.empty")}
                  className="erp-lines__account"
                />
              </LineField>
              <LineField label={t("payments.amount")}>
                <InputText
                  dir="ltr"
                  value={line.amount}
                  onChange={(e) => replaceLine({ ...line, amount: normalizePaymentAmount(e.target.value) })}
                  className={line.amount !== "" && !DECIMAL.test(line.amount) ? "erp-lines__amount p-invalid" : "erp-lines__amount"}
                />
              </LineField>
              <LineField label={t("cashExpenses.description")}>
                <InputText
                  value={line.description}
                  onChange={(e) => replaceLine({ ...line, description: e.target.value })}
                  placeholder={t("cashExpenses.lineDescriptionPlaceholder")}
                  className="erp-lines__description"
                />
              </LineField>
              <Button
                type="button"
                icon="pi pi-trash"
                text
                severity="danger"
                aria-label={t("actions.removeLine")}
                onClick={() => removeLine(line.id)}
                disabled={lines.length === 1}
              />
            </div>
          ))}
        </div>
        <Button type="button" label={t("cashExpenses.addLine")} icon="pi pi-plus" text onClick={addLine} />

        {showTotal ? (
          <div className="erp-lines__totals">
            <span>
              {t("cashExpenses.total")}: <strong>{formatMoney(total, currency)}</strong>
            </span>
          </div>
        ) : null}

        {errKey ? <p className="erp-auth-card__error">{t(errKey)}</p> : null}
        <div className="erp-form__actions">
          <Button type="button" label={t("actions.cancel")} text onClick={() => void navigate("/payments/cash-expenses")} />
          <Button type="button" label={t("actions.save")} icon="pi pi-check" disabled={!valid || !draft.ready || created !== null} loading={create.isPending} onClick={() => { void submit(); }} />
        </div>
      </div>
      <CreatedDialog info={created} onHide={() => void navigate("/payments/cash-expenses")} />
      <CostCentersDialog visible={showCenters} onHide={() => setShowCenters(false)} />
    </div>
  );
}
