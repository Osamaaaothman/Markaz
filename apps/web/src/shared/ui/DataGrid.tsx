import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { DataTable, type DataTableRowClickEvent, type DataTableValueArray } from "primereact/datatable";
import { InputText } from "primereact/inputtext";

export interface DataGridProps {
  readonly value: readonly object[] | undefined;
  readonly children: React.ReactNode;
  readonly className?: string;
  readonly emptyMessage?: string;
  readonly stripedRows?: boolean;
  readonly showGridlines?: boolean;
  readonly size?: "small" | "normal" | "large";
  readonly selectionMode?: "single";
  readonly onRowClick?: (event: DataTableRowClickEvent) => void;
  // Extra filter controls (a status dropdown, a date range) drawn next to the search box.
  readonly toolbar?: React.ReactNode;
  readonly searchable?: boolean;
  readonly pageSize?: number;
}

const PAGE_SIZES = [10, 25, 50, 100];

// Collects the text a person could be searching for in one row: its own string and number fields and those of
// one level of nested objects. Done once per row, not per keystroke.
function haystack(row: object): string {
  const parts: string[] = [];
  const visit = (value: unknown, depth: number): void => {
    if (typeof value === "string" || typeof value === "number") parts.push(String(value));
    else if (depth < 2 && value !== null && typeof value === "object" && !Array.isArray(value)) {
      for (const inner of Object.values(value)) visit(inner, depth + 1);
    }
  };
  visit(row, 0);
  return parts.join(" ").toLocaleLowerCase();
}

// The one table every list screen uses: a search box over what is already loaded, optional extra filters, page
// numbers with a rows-per-page choice, and no scroll box of its own — the whole page scrolls, and the header
// row sticks under the top bar. Reports and totals tables do not use it (they must show every row).
export function DataGrid({ value, toolbar, searchable = true, pageSize = 25, className = "", children, emptyMessage, ...rest }: DataGridProps): React.JSX.Element {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [first, setFirst] = useState(0);
  const [rows, setRows] = useState(pageSize);

  const indexed = useMemo(() => (value ?? []).map((row) => ({ row, text: haystack(row) })), [value]);
  const needle = query.trim().toLocaleLowerCase();
  const filtered = useMemo(() => (needle ? indexed.filter((entry) => entry.text.includes(needle)).map((entry) => entry.row) : (value ?? [])), [indexed, needle, value]);
  const total = filtered.length;
  const showPaginator = total > Math.min(...PAGE_SIZES);

  return (
    <div className="mk-grid">
      {searchable || toolbar ? (
        <div className="mk-grid__toolbar">
          {searchable ? (
            <span className="mk-grid__search p-input-icon-left">
              <i className="pi pi-search" aria-hidden="true" />
              <InputText
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setFirst(0);
                }}
                placeholder={t("table.search")}
                aria-label={t("table.search")}
              />
            </span>
          ) : null}
          {toolbar}
          <span className="mk-grid__count">{needle ? t("table.matches", { shown: total, total: value?.length ?? 0 }) : t("table.rowCount", { total })}</span>
        </div>
      ) : null}

      <DataTable
        {...rest}
        value={filtered as unknown as DataTableValueArray}
        className={className.includes("erp-table") ? className : `erp-table ${className}`.trim()}
        emptyMessage={needle ? t("table.noMatch") : emptyMessage}
        paginator={showPaginator}
        first={first}
        rows={rows}
        rowsPerPageOptions={PAGE_SIZES}
        onPage={(e) => {
          setFirst(e.first);
          setRows(e.rows);
        }}
        paginatorTemplate="RowsPerPageDropdown FirstPageLink PrevPageLink PageLinks NextPageLink LastPageLink CurrentPageReport"
        currentPageReportTemplate={t("table.report")}
      >
        {children}
      </DataTable>
    </div>
  );
}
