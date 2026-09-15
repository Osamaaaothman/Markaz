import { useTranslation } from "react-i18next";
import { Column } from "primereact/column";
import { DataTable } from "primereact/datatable";
import { Dialog } from "primereact/dialog";
import { Tag } from "primereact/tag";
import { formatCalendarDate } from "../../shared/lib/format-date";
import { formatMoney } from "../../shared/lib/money";
import { PageSkeleton } from "../../shared/ui/PageSkeleton";
import { useJournalEntry, type JournalEntryLineDetail } from "./use-journal-entries";

export function JournalEntryDetailDialog({
  entryId,
  onHide,
}: {
  entryId: string | null;
  onHide: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { data: entry, isPending, isError } = useJournalEntry(entryId);

  return (
    <Dialog
      header={entry ? `${t("accounting.journalEntries.details")} — ${entry.number}` : t("accounting.journalEntries.details")}
      visible={entryId !== null}
      onHide={onHide}
      className="erp-dialog erp-dialog--wide"
      modal
    >
      {isPending ? (
        <PageSkeleton />
      ) : isError || !entry ? (
        <p className="erp-page__error">{t("accounting.journalEntries.loadError")}</p>
      ) : (
        <div className="erp-form">
          {entry.isReversal ? (
            <Tag
              severity="warning"
              value={t("accounting.journalEntries.reversalOf", { number: entry.reversalOfEntryNumber })}
            />
          ) : null}

          <div className="erp-form__row">
            <div className="erp-field">
              <label>{t("accounting.journalEntries.entryDate")}</label>
              <p>{formatCalendarDate(entry.entryDate, i18n.language)}</p>
            </div>
            <div className="erp-field">
              <label>{t("accounting.journalEntries.postingDate")}</label>
              <p>{formatCalendarDate(entry.postingDate, i18n.language)}</p>
            </div>
            <div className="erp-field">
              <label>{t("accounting.journalEntries.currency")}</label>
              <p>{entry.currency}</p>
            </div>
            {entry.exchangeRate ? (
              <div className="erp-field">
                <label>{t("accounting.journalEntries.exchangeRate")}</label>
                <p>{entry.exchangeRate}</p>
              </div>
            ) : null}
          </div>

          <div className="erp-form__row">
            <div className="erp-field">
              <label>{t("accounting.journalEntries.sourceDocumentType")}</label>
              <p>{entry.sourceDocumentType}</p>
            </div>
            <div className="erp-field">
              <label>{t("accounting.journalEntries.sourceDocumentId")}</label>
              <p>{entry.sourceDocumentId}</p>
            </div>
          </div>

          <DataTable value={[...entry.lines]} className="erp-table" size="small" showGridlines>
            <Column
              header={t("accounting.journalEntries.account")}
              body={(row: JournalEntryLineDetail) => `${row.accountCode} — ${row.accountName}`}
            />
            <Column header={t("accounting.journalEntries.description")} field="description" />
            <Column
              header={t("accounting.journalEntries.debit")}
              align="right"
              alignHeader="right"
              body={(row: JournalEntryLineDetail) => formatMoney(row.debit, entry.currency)}
            />
            <Column
              header={t("accounting.journalEntries.credit")}
              align="right"
              alignHeader="right"
              body={(row: JournalEntryLineDetail) => formatMoney(row.credit, entry.currency)}
            />
          </DataTable>

          <div className="erp-form__row" style={{ justifyContent: "flex-end", gap: "2rem" }}>
            <p>
              <strong>{t("accounting.journalEntries.totalDebit")}:</strong> {formatMoney(entry.totalDebit, entry.currency)}
            </p>
            <p>
              <strong>{t("accounting.journalEntries.totalCredit")}:</strong> {formatMoney(entry.totalCredit, entry.currency)}
            </p>
          </div>
        </div>
      )}
    </Dialog>
  );
}
