import { Children, isValidElement, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "primereact/button";
import { Checkbox } from "primereact/checkbox";
import { DataTable, type DataTableRowClickEvent, type DataTableValueArray } from "primereact/datatable";
import { InputText } from "primereact/inputtext";
import { OverlayPanel } from "primereact/overlaypanel";

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
const MIN_TOGGLEABLE = 3;

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

function readHidden(storageKey: string): ReadonlySet<string> {
  try {
    const raw = localStorage.getItem(storageKey);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function writeHidden(storageKey: string, hidden: ReadonlySet<string>): void {
  try {
    if (hidden.size === 0) localStorage.removeItem(storageKey);
    else localStorage.setItem(storageKey, JSON.stringify([...hidden]));
  } catch {
    // Private mode or blocked storage: the choice simply is not remembered.
  }
}

// The title of a column when it has a plain-text one. Action columns (empty header) are never hideable.
function headerOf(child: React.ReactNode): string | null {
  if (!isValidElement(child)) return null;
  const header = (child.props as { header?: unknown }).header;
  return typeof header === "string" && header.trim() !== "" ? header : null;
}

// The one table every list screen uses: a search box over what is already loaded, optional extra filters, a
// choice of which columns to show (remembered per table on this device), page numbers with a rows-per-page
// choice, and no scroll box of its own — the whole page scrolls, and the header row sticks under the top bar.
// Reports and totals tables do not use it (they must show every row).
export function DataGrid({ value, toolbar, searchable = true, pageSize = 25, className = "", children, emptyMessage, ...rest }: DataGridProps): React.JSX.Element {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [first, setFirst] = useState(0);
  const [rows, setRows] = useState(pageSize);
  const panel = useRef<OverlayPanel>(null);

  const columns = useMemo(() => Children.toArray(children), [children]);
  const headers = useMemo(() => columns.map(headerOf).filter((h): h is string => h !== null), [columns]);
  const toggleable = headers.length >= MIN_TOGGLEABLE;
  // The column titles identify the table: two screens never share the same set of titles.
  const storageKey = `mk-cols:${headers.join("|")}`;
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => readHidden(storageKey));
  const shown = toggleable ? columns.filter((child) => !hidden.has(headerOf(child) ?? "\u0000")) : columns;

  const indexed = useMemo(() => (value ?? []).map((row) => ({ row, text: haystack(row) })), [value]);
  const needle = query.trim().toLocaleLowerCase();
  const filtered = useMemo(() => (needle ? indexed.filter((entry) => entry.text.includes(needle)).map((entry) => entry.row) : (value ?? [])), [indexed, needle, value]);
  const total = filtered.length;
  const showPaginator = total > Math.min(...PAGE_SIZES);

  const toggleColumn = (header: string, visible: boolean): void => {
    const next = new Set(hidden);
    if (visible) next.delete(header);
    else if (headers.length - next.size > 1) next.add(header); // at least one column always stays
    setHidden(next);
    writeHidden(storageKey, next);
  };

  return (
    <div className="mk-grid">
      {searchable || toolbar || toggleable ? (
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
          {toggleable ? (
            <>
              <Button
                type="button"
                icon="pi pi-sliders-h"
                label={t("table.columns")}
                outlined
                severity="secondary"
                badge={hidden.size > 0 ? String(hidden.size) : undefined}
                badgeClassName="p-badge-warning"
                aria-label={t("table.columns")}
                onClick={(e) => panel.current?.toggle(e)}
              />
              <OverlayPanel ref={panel} className="mk-grid__columns">
                <ul>
                  {headers.map((header, index) => (
                    <li key={`${header}-${index}`}>
                      <label>
                        <Checkbox checked={!hidden.has(header)} onChange={(e) => toggleColumn(header, Boolean(e.checked))} />
                        <span>{header}</span>
                      </label>
                    </li>
                  ))}
                </ul>
                {hidden.size > 0 ? (
                  <button
                    type="button"
                    className="erp-button-link"
                    onClick={() => {
                      setHidden(new Set());
                      writeHidden(storageKey, new Set());
                    }}
                  >
                    {t("table.resetColumns")}
                  </button>
                ) : null}
              </OverlayPanel>
            </>
          ) : null}
          <span className="mk-grid__count">{needle ? t("table.matches", { shown: total, total: value?.length ?? 0 }) : t("table.rowCount", { total })}</span>
        </div>
      ) : null}

      {/* keyed by the hidden set: PrimeReact memoises body rows and would otherwise keep drawing the old columns */}
      <DataTable
        key={[...hidden].sort().join("|")}
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
        {shown}
      </DataTable>
    </div>
  );
}
