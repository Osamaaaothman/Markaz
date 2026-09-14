import { zodResolver } from "@hookform/resolvers/zod";
import { Money } from "@erp/shared";
import { useEffect } from "react";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Button } from "primereact/button";
import { Calendar } from "primereact/calendar";
import { Dialog } from "primereact/dialog";
import { Dropdown } from "primereact/dropdown";
import { InputText } from "primereact/inputtext";
import { z } from "zod";
import { useAccounts } from "./use-accounts";
import { useFiscalPeriods } from "./use-fiscal-periods";
import { usePostJournalEntry, type PostJournalEntryInput } from "./use-post-journal-entry";
import { formatMoney } from "../../shared/lib/money";
import { toDateOnlyIsoString } from "../../shared/lib/format-date";

const lineSchema = z
  .object({
    accountId: z.string().min(1, "required"),
    debit: z.string(),
    credit: z.string(),
    description: z.string(),
  })
  .refine(
    (line) => {
      const hasDebit = line.debit.trim().length > 0;
      const hasCredit = line.credit.trim().length > 0;
      return hasDebit !== hasCredit;
    },
    { message: "exactlyOneAmount", path: ["debit"] },
  );

const formSchema = z
  .object({
    fiscalPeriodId: z.string().min(1, "required"),
    entryDate: z.date(),
    postingDate: z.date(),
    currency: z.string().min(1, "required"),
    sourceDocumentType: z.string().min(1, "required"),
    sourceDocumentId: z.string().min(1, "required"),
    lines: z.array(lineSchema).min(2, "minLines"),
  })
  .refine(
    (data) => {
      try {
        let debitTotal = Money.zero(data.currency);
        let creditTotal = Money.zero(data.currency);
        for (const line of data.lines) {
          if (line.debit.trim()) debitTotal = debitTotal.add(Money.of(line.debit, data.currency));
          if (line.credit.trim()) creditTotal = creditTotal.add(Money.of(line.credit, data.currency));
        }
        return debitTotal.equals(creditTotal) && debitTotal.isPositive();
      } catch {
        return false;
      }
    },
    { message: "mustBalance", path: ["lines"] },
  );

type FormValues = z.infer<typeof formSchema>;

const EMPTY_LINE = { accountId: "", debit: "", credit: "", description: "" };

export interface JournalEntryFormProps {
  readonly visible: boolean;
  readonly onHide: () => void;
}

export function JournalEntryForm({ visible, onHide }: JournalEntryFormProps): React.JSX.Element {
  const { t } = useTranslation();
  const { data: accounts } = useAccounts();
  const { data: fiscalPeriods } = useFiscalPeriods();
  const postEntry = usePostJournalEntry();

  const {
    control,
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      fiscalPeriodId: "",
      entryDate: new Date(),
      postingDate: new Date(),
      currency: "SAR",
      sourceDocumentType: "manual",
      sourceDocumentId: "",
      lines: [EMPTY_LINE, EMPTY_LINE],
    },
  });

  const { fields, append, remove } = useFieldArray({ control, name: "lines" });
  const currency = watch("currency");
  const lines = watch("lines");

  useEffect(() => {
    if (visible) {
      reset();
      postEntry.reset();
    }
    // Deliberately keyed on `visible` alone — reset()/postEntry.reset() are
    // stable identities (react-hook-form/TanStack Query), and re-running this
    // whenever `postEntry` itself changes would fight the mutation it's supposed
    // to be clearing.
  }, [visible]);

  const totals = lines.reduce(
    (acc, line) => {
      try {
        if (line.debit?.trim()) acc.debit = acc.debit.add(Money.of(line.debit, currency || "SAR"));
        if (line.credit?.trim()) acc.credit = acc.credit.add(Money.of(line.credit, currency || "SAR"));
      } catch {
        /* invalid amount — surfaced by field-level validation instead */
      }
      return acc;
    },
    { debit: Money.zero(currency || "SAR"), credit: Money.zero(currency || "SAR") },
  );

  const onSubmit = handleSubmit((values) => {
    const input: PostJournalEntryInput = {
      fiscalPeriodId: values.fiscalPeriodId,
      entryDate: toDateOnlyIsoString(values.entryDate),
      postingDate: toDateOnlyIsoString(values.postingDate),
      currency: values.currency,
      sourceDocumentType: values.sourceDocumentType,
      sourceDocumentId: values.sourceDocumentId,
      lines: values.lines.map((line) => ({
        accountId: line.accountId,
        ...(line.debit.trim() ? { debit: line.debit } : {}),
        ...(line.credit.trim() ? { credit: line.credit } : {}),
        ...(line.description.trim() ? { description: line.description } : {}),
      })),
    };
    postEntry.mutate(input, { onSuccess: onHide });
  });

  return (
    <Dialog
      header={t("accounting.journalEntries.new")}
      visible={visible}
      onHide={onHide}
      className="erp-dialog"
      modal
    >
      <form onSubmit={(e) => void onSubmit(e)} noValidate className="erp-form">
        <div className="erp-form__row">
          <div className="erp-field">
            <label htmlFor="fiscalPeriodId">{t("accounting.journalEntries.fiscalPeriod")}</label>
            <Controller
              control={control}
              name="fiscalPeriodId"
              render={({ field }) => (
                <Dropdown
                  inputId="fiscalPeriodId"
                  value={field.value}
                  onChange={(e) => field.onChange(e.value)}
                  options={(fiscalPeriods ?? []).map((p) => ({
                    label: `${t("accounting.journalEntries.fiscalPeriod")} ${p.periodNumber}`,
                    value: p.id,
                  }))}
                  className={errors.fiscalPeriodId ? "p-invalid" : ""}
                />
              )}
            />
          </div>
          <div className="erp-field">
            <label htmlFor="currency">{t("accounting.journalEntries.currency")}</label>
            <InputText id="currency" {...register("currency")} />
          </div>
        </div>

        <div className="erp-form__row">
          <div className="erp-field">
            <label htmlFor="entryDate">{t("accounting.journalEntries.entryDate")}</label>
            <Controller
              control={control}
              name="entryDate"
              render={({ field }) => (
                <Calendar inputId="entryDate" value={field.value} onChange={(e) => field.onChange(e.value)} dateFormat="yy-mm-dd" />
              )}
            />
          </div>
          <div className="erp-field">
            <label htmlFor="postingDate">{t("accounting.journalEntries.postingDate")}</label>
            <Controller
              control={control}
              name="postingDate"
              render={({ field }) => (
                <Calendar inputId="postingDate" value={field.value} onChange={(e) => field.onChange(e.value)} dateFormat="yy-mm-dd" />
              )}
            />
          </div>
        </div>

        <div className="erp-form__row">
          <div className="erp-field">
            <label htmlFor="sourceDocumentType">{t("accounting.journalEntries.sourceDocumentType")}</label>
            <InputText id="sourceDocumentType" {...register("sourceDocumentType")} />
          </div>
          <div className="erp-field">
            <label htmlFor="sourceDocumentId">{t("accounting.journalEntries.sourceDocumentId")}</label>
            <InputText id="sourceDocumentId" {...register("sourceDocumentId")} />
          </div>
        </div>

        <h3 className="erp-form__section-title">{t("accounting.journalEntries.lines")}</h3>
        <div className="erp-lines">
          {fields.map((field, index) => (
            <div key={field.id} className="erp-lines__row">
              <Controller
                control={control}
                name={`lines.${index}.accountId`}
                render={({ field: f }) => (
                  <Dropdown
                    value={f.value}
                    onChange={(e) => f.onChange(e.value)}
                    options={(accounts ?? []).map((a) => ({ label: `${a.code} — ${a.name}`, value: a.id }))}
                    filter
                    placeholder={t("accounting.journalEntries.account")}
                    className={errors.lines?.[index]?.accountId ? "p-invalid erp-lines__account" : "erp-lines__account"}
                  />
                )}
              />
              <InputText
                placeholder={t("accounting.journalEntries.debit")}
                {...register(`lines.${index}.debit`)}
                className={`erp-lines__amount${errors.lines?.[index]?.debit ? " p-invalid" : ""}`}
              />
              <InputText
                placeholder={t("accounting.journalEntries.credit")}
                {...register(`lines.${index}.credit`)}
                className="erp-lines__amount"
              />
              <InputText
                placeholder={t("accounting.journalEntries.description")}
                {...register(`lines.${index}.description`)}
                className="erp-lines__description"
              />
              <Button
                type="button"
                icon="pi pi-trash"
                text
                severity="danger"
                aria-label={t("actions.removeLine")}
                onClick={() => remove(index)}
                disabled={fields.length <= 2}
              />
            </div>
          ))}
        </div>
        <Button
          type="button"
          label={t("actions.addLine")}
          icon="pi pi-plus"
          text
          onClick={() => append(EMPTY_LINE)}
        />

        <div className="erp-lines__totals">
          <span>
            {t("accounting.journalEntries.totalDebit")}: <strong>{formatMoney(totals.debit.toDecimalString(), currency || "SAR")}</strong>
          </span>
          <span>
            {t("accounting.journalEntries.totalCredit")}: <strong>{formatMoney(totals.credit.toDecimalString(), currency || "SAR")}</strong>
          </span>
        </div>

        {errors.lines?.root?.message ? (
          <p className="erp-field__error">{t(`validation.${errors.lines.root.message}`)}</p>
        ) : null}

        {postEntry.isError ? <p className="erp-auth-card__error">{t("accounting.journalEntries.postError")}</p> : null}

        <div className="erp-form__actions">
          <Button type="button" label={t("actions.cancel")} outlined onClick={onHide} />
          <Button type="submit" label={t("accounting.journalEntries.submit")} loading={postEntry.isPending} />
        </div>
      </form>
    </Dialog>
  );
}
