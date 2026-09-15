import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "primereact/button";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Tag } from "primereact/tag";
import { formatCalendarDate } from "../../shared/lib/format-date";
import { formatMoney } from "../../shared/lib/money";
import { PageSkeleton } from "../../shared/ui/PageSkeleton";
import { JournalEntryForm } from "./JournalEntryForm";
import { useJournalEntries, type JournalEntrySummary } from "./use-journal-entries";

export function JournalEntriesPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const { data, isPending, isError, fetchNextPage, hasNextPage, isFetchingNextPage } = useJournalEntries();
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

      {isPending ? (
        <PageSkeleton />
      ) : isError ? (
        <p className="erp-page__error">{t("status.error")}</p>
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
