import { Children, cloneElement, isValidElement, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "primereact/button";
import { Column } from "primereact/column";
import { Checkbox } from "primereact/checkbox";
import { FilterMatchMode } from "primereact/api";
import { DataTable, type DataTableFilterMeta, type DataTableRowClickEvent, type DataTableValueArray } from "primereact/datatable";
import { InputText } from "primereact/inputtext";
import { OverlayPanel } from "primereact/overlaypanel";
import { EmptyState, type EmptyStateAction } from "./EmptyState";

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
  // What an empty list shows beside its message: an icon and, where the person may create the record, the button that does it.
  readonly emptyIcon?: string;
  readonly emptyAction?: EmptyStateAction & { readonly allowed?: boolean };
}

const PAGE_SIZES = [10, 25, 50, 100];
const COPIED_MS = 1500;

// Copies a row's id (its UUID) so it can be pasted into a support ticket, a URL or a search box. The click is
// kept from reaching the row, which would otherwise open the record.
function CopyIdButton({ id }: { id: string }): React.JSX.Element {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
      window.setTimeout(() => setCopied(false), COPIED_MS);
    } catch {
      // Clipboard blocked (insecure origin or denied permission): nothing to copy to.
    }
  };
  return (
    <Button
      type="button"
      icon={copied ? "pi pi-check" : "pi pi-copy"}
      rounded
      text
      severity={copied ? "success" : "secondary"}
      aria-label={copied ? t("table.copied") : t("table.copyId")}
      tooltip={copied ? t("table.copied") : t("table.copyId")}
      tooltipOptions={{ position: "top" }}
      onClick={(e) => {
        e.stopPropagation();
        void copy();
      }}
    />
  );
}

function rowId(row: unknown): string | null {
  const id = (row as { id?: unknown } | null)?.id;
  return typeof id === "string" && id !== "" ? id : null;
}
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
// A column opts into its own filter with PrimeReact's `filter` and a `field`; the filter menu is then a funnel in
// that column's header. Filters apply to the rows already loaded, like the search box.
interface FilteredColumn {
  readonly field: string;
  readonly matchMode: FilterMatchMode;
}

function filteredColumnsOf(columns: readonly React.ReactNode[]): FilteredColumn[] {
  return columns.flatMap((child) => {
    if (!isValidElement(child)) return [];
    const props = child.props as { filter?: boolean; field?: string; filterMatchMode?: FilterMatchMode };
    return props.filter && props.field ? [{ field: props.field, matchMode: props.filterMatchMode ?? FilterMatchMode.CONTAINS }] : [];
  });
}

function emptyFilters(columns: readonly FilteredColumn[]): DataTableFilterMeta {
  return Object.fromEntries(columns.map(({ field, matchMode }) => [field, { value: null, matchMode }]));
}

export function DataGrid({ value, toolbar, searchable = true, pageSize = 25, className = "", children, emptyMessage, emptyIcon, emptyAction, ...rest }: DataGridProps): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const [query, setQuery] = useState("");
  const [first, setFirst] = useState(0);
  const [rows, setRows] = useState(pageSize);
  const panel = useRef<OverlayPanel>(null);
  const root = useRef<HTMLDivElement>(null);
  // A table wider than its card used to be clipped, hiding its last column (usually the amounts). When the table
  // does not fit, this grid alone gets a sideways scroll; tables that fit keep the header that sticks to the page.
  const [overflowing, setOverflowing] = useState(false);
  useEffect(() => {
    const table = root.current?.querySelector<HTMLElement>(".p-datatable-table");
    const wrapper = root.current?.querySelector<HTMLElement>(".p-datatable-wrapper");
    if (!table || !wrapper || typeof ResizeObserver === "undefined") return;
    const measure = (): void => setOverflowing(table.scrollWidth > (root.current?.clientWidth ?? 0) + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(table);
    if (root.current) observer.observe(root.current);
    return () => observer.disconnect();
  });

  const columns = useMemo(() => Children.toArray(children), [children]);
  const filteredColumns = useMemo(() => filteredColumnsOf(columns), [columns]);
  const headers = useMemo(() => columns.map(headerOf).filter((h): h is string => h !== null), [columns]);
  const toggleable = headers.length >= MIN_TOGGLEABLE;
  // The column titles identify the table: two screens never share the same set of titles.
  const storageKey = `mk-cols:${headers.join("|")}`;
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => readHidden(storageKey));
  const visible = toggleable ? columns.filter((child) => !hidden.has(headerOf(child) ?? "\u0000")) : columns;
  // A column filter stays a plain contains-box: no match-mode picker, no extra rules.
  const shown = visible.map((child) =>
    isValidElement(child) && (child.props as { filter?: boolean }).filter
      ? cloneElement(child as React.ReactElement<Record<string, unknown>>, { showFilterMatchModes: false, showFilterOperator: false, showAddButton: false, filterPlaceholder: t("table.filterPlaceholder") })
      : child,
  );
  const hasFilters = filteredColumns.length > 0;

  const indexed = useMemo(() => (value ?? []).map((row) => ({ row, text: haystack(row) })), [value]);
  const needle = query.trim().toLocaleLowerCase();
  const filtered = useMemo(() => (needle ? indexed.filter((entry) => entry.text.includes(needle)).map((entry) => entry.row) : (value ?? [])), [indexed, needle, value]);
  const [filters, setFilters] = useState<DataTableFilterMeta>(() => emptyFilters(filteredColumns));
  // Rows left after the column filters too, as reported by the table itself.
  const [afterFilters, setAfterFilters] = useState<number | null>(null);
  const total = afterFilters ?? filtered.length;
  const showPaginator = total > Math.min(...PAGE_SIZES);

  const toggleColumn = (header: string, visible: boolean): void => {
    const next = new Set(hidden);
    if (visible) next.delete(header);
    else if (headers.length - next.size > 1) next.add(header); // at least one column always stays
    setHidden(next);
    writeHidden(storageKey, next);
  };

  return (
    <div className={`mk-grid${overflowing ? " mk-grid--scroll" : ""}`} ref={root}>
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
          <span className="mk-grid__count">{needle || total !== (value?.length ?? 0) ? t("table.matches", { shown: total, total: value?.length ?? 0 }) : t("table.rowCount", { total })}</span>
        </div>
      ) : null}

      {/* keyed by the hidden set and the language: PrimeReact memoises body rows and would otherwise keep
          drawing the old columns, or the old language's text inside a Column body (e.g. a status Tag), after
          toggling a column's visibility or switching AR/EN without a full page navigation in between. */}
      <DataTable
        key={`${[...hidden].sort().join("|")}:${i18n.language}`}
        {...rest}
        value={filtered as unknown as DataTableValueArray}
        className={className.includes("erp-table") ? className : `erp-table ${className}`.trim()}
        filters={hasFilters ? filters : undefined}
        filterDisplay={hasFilters ? "menu" : undefined}
        onFilter={(e) => {
          setFilters(e.filters);
          setFirst(0);
        }}
        onValueChange={(rows) => setAfterFilters(hasFilters ? rows.length : null)}
        emptyMessage={
          needle ? (
            <EmptyState icon="pi pi-search" title={t("table.noMatch")} />
          ) : (
            <EmptyState icon={emptyIcon} title={emptyMessage ?? t("status.empty")} action={emptyAction && emptyAction.allowed !== false ? emptyAction : undefined} />
          )
        }
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
        {rowId(value?.[0]) !== null ? <Column key="mk-copy-id" style={{ width: "3.5rem" }} body={(row: object) => (rowId(row) ? <CopyIdButton id={rowId(row) as string} /> : null)} /> : null}
      </DataTable>
    </div>
  );
}
