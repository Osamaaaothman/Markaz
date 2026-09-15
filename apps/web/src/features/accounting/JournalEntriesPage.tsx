import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "primereact/button";
import { Calendar } from "primereact/calendar";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Tag } from "primereact/tag";
import { formatCalendarDate, toDateOnlyIsoString } from "../../shared/lib/format-date";
import { formatMoney } from "../../shared/lib/money";
import { PageSkeleton } from "../../shared/ui/PageSkeleton";
import { JournalEntryForm } from "./JournalEntryForm";
import { useJournalEntries, type JournalEntrySummary } from "./use-journal-entries";

export function JournalEntriesPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const [filterRange, setFilterRange] = useState<{ from: Date | null; to: Date | null }>({ from: null, to: null });
  const filter = {
    ...(filterRange.from ? { from: toDateOnlyIsoString(filterRange.from) } : {}),
    ...(filterRange.to ? { to: toDateOnlyIsoString(filterRange.to) } : {}),
  };
  const { data, isPending, isError, fetchNextPage, hasNextPage, isFetchingNextPage, refetch } = useJournalEntries(filter);
  const [formVisible, setFormVisible] = useState(false);

  const entries = data?.pages.flatMap((page) => page.data) ?? [];

  return (
    <div className="erp-page">
      <div className="erp-page__header">
        <div>
          <h1 className="erp-page__title">{t("accounting.journalEntries.title")}</h1>
          <p className="erp-page__subtitle">{t("accounting.journalEntries.subtitle")}</p>
        </div>
        <Button label={t("accounting.journalEntries.new")} icon="pi pi-plus" onClick={() => setFormVisible(true)} />
      </div>

      <div className="erp-form__row">
        <div className="erp-field">
          <label htmlFor="journalEntriesFrom">{t("accounting.journalEntries.filterFrom")}</label>
          <Calendar
            inputId="journalEntriesFrom"
            value={filterRange.from}
            onChange={(e) => setFilterRange((prev) => ({ ...prev, from: e.value ?? null }))}
            dateFormat="yy-mm-dd"
            showButtonBar
          />
        </div>
        <div className="erp-field">
          <label htmlFor="journalEntriesTo">{t("accounting.journalEntries.filterTo")}</label>
          <Calendar
            inputId="journalEntriesTo"
            value={filterRange.to}
            onChange={(e) => setFilterRange((prev) => ({ ...prev, to: e.value ?? null }))}
            dateFormat="yy-mm-dd"
            showButtonBar
          />
        </div>
      </div>

      {isPending ? (
        <PageSkeleton />
      ) : isError ? (
        <div className="erp-page">
          <p className="erp-page__error">{t("status.error")}</p>
          <button type="button" className="erp-button-link" onClick={() => void refetch()}>
            {t("actions.retry")}
          </button>
        </div>
      ) : entries.length === 0 ? (
        <p className="erp-page__empty">{t("status.empty")}</p>
      ) : (
        <>
          <DataTable value={entries} className="erp-table" stripedRows showGridlines size="small">
            <Column field="number" header="#" style={{ width: "8rem" }} />
            <Column
              field="entryDate"
              header={t("accounting.journalEntries.entryDate")}
              body={(row: JournalEntrySummary) => formatCalendarDate(row.entryDate, i18n.language)}
            />
            <Column field="sourceDocumentType" header={t("accounting.journalEntries.sourceDocumentType")} />
            <Column
              field="totalDebit"
              header={t("accounting.journalEntries.totalDebit")}
              align="right"
              alignHeader="right"
              body={(row: JournalEntrySummary) => formatMoney(row.totalDebit, row.currency)}
            />
            <Column
              field="isReversal"
              header=""
              body={(row: JournalEntrySummary) =>
                row.isReversal ? <Tag value={t("actions.reverse")} severity="warning" /> : null
              }
              style={{ width: "8rem" }}
            />
          </DataTable>
          {hasNextPage ? (
            <div className="erp-table-footer erp-table-footer--center">
              <Button
                label={t("actions.loadMore")}
                text
                onClick={() => void fetchNextPage()}
                loading={isFetchingNextPage}
                icon="pi pi-chevron-down"
              />
            </div>
          ) : null}
        </>
      )}

      <JournalEntryForm visible={formVisible} onHide={() => setFormVisible(false)} />
    </div>
  );
}
