import { useRef, useState } from "react";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { InputText } from "primereact/inputtext";
import { InputNumber } from "primereact/inputnumber";
import { Dropdown } from "primereact/dropdown";
import { MultiSelect } from "primereact/multiselect";
import { SelectButton } from "primereact/selectbutton";
import { Checkbox } from "primereact/checkbox";
import { InputSwitch } from "primereact/inputswitch";
import { RadioButton } from "primereact/radiobutton";
import { OverlayPanel } from "primereact/overlaypanel";
import { TreeTable } from "primereact/treetable";
import { TabPanel, TabView } from "primereact/tabview";
import { Tooltip } from "primereact/tooltip";
import { INVOICES, money, type Invoice } from "./catalog";
import { Amount, B, DemoField, Icon, Panel, Section, Status, downloadText, usePreview } from "./ui";

export function DashboardSection(): React.JSX.Element {
  const { t, open } = usePreview();
  const [period, setPeriod] = useState("month");
  const values =
    period === "month" ? [36, 48, 40, 64, 51, 82, 70, 91] : [58, 40, 68, 79, 61, 92, 74, 99];
  return (
    <Section id="dashboard">
      <div className="rd-workspace-header">
        <div>
          <h3>{t("greeting")}</h3>
          <p>{t("today")}</p>
        </div>
        <B
          label={t("newInvoice")}
          icon="pi pi-plus"
          onClick={() =>
            document.getElementById("documents")?.scrollIntoView({ behavior: "instant" })
          }
        />
      </div>
      <div className="rd-kpis">
        {(
          [
            ["revenue", "arrow-up-right", 12845000, "+12.8%"],
            ["receivables", "inbox", 3428000, "8"],
            ["expenses", "arrow-down-left", 7832000, "−4.2%"],
            ["cash", "wallet", 39198400, "+8.6%"],
          ] as const
        ).map(([key, icon, value, change]) => (
          <button
            type="button"
            className="rd-kpi"
            key={key}
            onClick={() => open(key === "receivables" ? "drawer" : "journalDetail")}
          >
            <span className="rd-kpi-top">
              <span>{t(key)}</span>
              <Icon name={icon} />
            </span>
            <strong>
              <Amount value={value} />
            </strong>
            <span className="rd-kpi-bottom">
              <b dir="ltr">{change}</b>
              <span>{key === "receivables" ? t("invoices") : t("vsLast")}</span>
            </span>
          </button>
        ))}
      </div>
      <div className="rd-dashboard-grid">
        <Panel
          title={t("cashFlow")}
          aside={
            <SelectButton
              value={period}
              options={["month", "quarter"].map((value) => ({ value, label: t(value) }))}
              onChange={(e) => {
                if (e.value) setPeriod(e.value as string);
              }}
              allowEmpty={false}
            />
          }
        >
          <p className="rd-muted rd-small">{t("chartNote")}</p>
          <div className="rd-chart" role="img" aria-label={`${t("revenue")} / ${t("expenses")}`}>
            <div className="rd-chart-axis">
              <span>100k</span>
              <span>75k</span>
              <span>50k</span>
              <span>25k</span>
              <span>0</span>
            </div>
            <div className="rd-chart-plot" dir="ltr">
              {values.map((height, index) => (
                <div className="rd-chart-col" key={index}>
                  <div className="rd-chart-bars">
                    <span
                      style={{ height: `${height}%` }}
                      title={`${t("revenue")}: ${height},000`}
                    />
                    <span
                      style={{ height: `${Math.round(height * 0.63)}%` }}
                      title={`${t("expenses")}: ${Math.round(height * 0.63)},000`}
                    />
                  </div>
                  <small>{String(index * 4 + 1).padStart(2, "0")}</small>
                </div>
              ))}
            </div>
          </div>
          <div className="rd-chart-legend">
            <span>
              <i />
              {t("revenue")}
            </span>
            <span>
              <i />
              {t("expenses")}
            </span>
          </div>
        </Panel>
        <Panel title={t("attention")} className="rd-attention">
          <span className="rd-attention-label">
            03 <span>{t("review")}</span>
          </span>
          {[
            ["overdueInvoices", "clock", "drawer"],
            ["approvalQueue", "check-square", "requestDetail"],
            ["lowStock", "box", "replenishment"],
          ].map(([label, icon, id]) => (
            <button
              type="button"
              className="rd-attention-row"
              key={label}
              onClick={() => open(id!)}
            >
              <span className="rd-icon-tile">
                <Icon name={icon!} />
              </span>
              <span>
                <strong>{t(label!)}</strong>
                <small>
                  {t("review")} <Icon name="arrow-up-left" />
                </small>
              </span>
            </button>
          ))}
        </Panel>
      </div>
    </Section>
  );
}

export function ActionsSection(): React.JSX.Element {
  const { t, open, notify } = usePreview();
  const [busy, setBusy] = useState(false);
  const panel = useRef<OverlayPanel>(null);
  async function copyNumber(): Promise<void> {
    try {
      await navigator.clipboard.writeText("INV-2026-0148");
      notify(t("copied"));
    } catch {
      notify(t("copyFailed"), "warn");
    }
  }
  return (
    <Section id="actions">
      <Panel>
        <div className="rd-button-groups">
          <div>
            <span className="rd-label">
              {t("primary")} / {t("secondary")}
            </span>
            <div className="rd-wrap">
              <B label={t("save")} icon="pi pi-check" onClick={() => notify()} />
              <B
                label={t("saveDraft")}
                outlined
                icon="pi pi-file-edit"
                onClick={() => notify(t("draftSaved"))}
              />
              <B label={t("cancel")} text onClick={() => notify(t("cancel"), "info")} />
              <B
                label={t("delete")}
                severity="danger"
                outlined
                icon="pi pi-trash"
                onClick={() => open("deleteDraft")}
              />
            </div>
          </div>
          <div>
            <span className="rd-label">
              {t("standard")} / {t("loading")}
            </span>
            <div className="rd-wrap">
              <B
                label={busy ? t("loading") : t("save")}
                loading={busy}
                onClick={() => {
                  setBusy(true);
                  window.setTimeout(() => {
                    setBusy(false);
                    notify();
                  }, 900);
                }}
              />
              <B label={t("disabled")} disabled />
              <B label={t("small")} size="small" outlined onClick={() => notify()} />
              <B label={t("large")} size="large" outlined onClick={() => notify()} />
            </div>
          </div>
          <div>
            <span className="rd-label">{t("more")}</span>
            <div className="rd-wrap">
              <B icon="pi pi-plus" aria-label={t("iconOnly")} onClick={() => open("party")} />
              <B icon="pi pi-pencil" outlined aria-label={t("edit")} onClick={() => open("item")} />
              <B
                icon="pi pi-copy"
                text
                aria-label={t("copyId")}
                className="rd-tooltip"
                data-pr-tooltip={t("copyId")}
                onClick={() => void copyNumber()}
              />
              <B
                label={t("more")}
                icon="pi pi-angle-down"
                outlined
                onClick={(e) => panel.current?.toggle(e)}
              />
              <button type="button" className="rd-copy" onClick={() => void copyNumber()}>
                <bdi>INV-2026-0148</bdi>
                <Icon name="copy" />
              </button>
            </div>
          </div>
        </div>
        <OverlayPanel ref={panel}>
          <div className="rd-menu-list">
            {[
              ["export", "download"],
              ["print", "print"],
              ["edit", "pencil"],
            ].map(([key, icon]) => (
              <button
                type="button"
                key={key}
                onClick={() => {
                  panel.current?.hide();
                  if (key === "export")
                    downloadText("sample-invoice.csv", "number,amount\nINV-2026-0148,12650.00");
                  else open(key === "print" ? "viewer" : "party");
                }}
              >
                <Icon name={icon!} />
                {t(key!)}
              </button>
            ))}
          </div>
        </OverlayPanel>
        <Tooltip target=".rd-tooltip" />
      </Panel>
    </Section>
  );
}

export function FieldsSection(): React.JSX.Element {
  const { t } = usePreview();
  const [checked, setChecked] = useState(true);
  const [enabled, setEnabled] = useState(true);
  const [method, setMethod] = useState("credit");
  const [selected, setSelected] = useState(["mainWarehouse"]);
  const [invalid, setInvalid] = useState("hello@");
  const invalidEmail = !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(invalid);
  return (
    <Section id="fields">
      <Panel>
        <div className="rd-form-grid rd-form-grid-three">
          <DemoField field="name" required />
          <DemoField field="customer" />
          <DemoField field="date" />
          <DemoField field="amount" />
          <DemoField field="password" />
          <div className="rd-field">
            <label htmlFor="demo-multi">{t("warehouses")}</label>
            <MultiSelect
              inputId="demo-multi"
              value={selected}
              onChange={(e) => setSelected(e.value as string[])}
              options={["mainWarehouse", "northWarehouse"].map((value) => ({
                value,
                label: t(value),
              }))}
              display="chip"
            />
          </div>
          <div className="rd-field">
            <label htmlFor="demo-invalid">{t("email")} *</label>
            <InputText
              id="demo-invalid"
              value={invalid}
              onChange={(e) => setInvalid(e.target.value)}
              invalid={invalidEmail}
              aria-invalid={invalidEmail}
              aria-describedby="email-error"
              dir="ltr"
            />
            <small id="email-error" className={invalidEmail ? "rd-error-text" : "rd-success-text"}>
              {t(invalidEmail ? "invalidEmail" : "success")}
            </small>
          </div>
          <DemoField field="code" readOnly />
          <DemoField field="warehouse" disabled />
          <DemoField field="notes" />
        </div>
        <div className="rd-form-options">
          <label htmlFor="demo-check">
            <Checkbox
              inputId="demo-check"
              checked={checked}
              onChange={(e) => setChecked(Boolean(e.checked))}
            />
            {t("notifyEmail")}
          </label>
          <label htmlFor="demo-switch">
            <InputSwitch
              inputId="demo-switch"
              checked={enabled}
              onChange={(e) => setEnabled(e.value)}
            />
            {t("active")}
          </label>
          <fieldset className="rd-radios">
            <legend>{t("paymentMethod")}</legend>
            {["credit", "cashMethod"].map((value) => (
              <label key={value} htmlFor={`method-${value}`}>
                <RadioButton
                  inputId={`method-${value}`}
                  name="payment-method"
                  value={value}
                  checked={method === value}
                  onChange={() => setMethod(value)}
                />
                {t(value)}
              </label>
            ))}
          </fieldset>
        </div>
        <div className="rd-wrap rd-statuses">
          {["paid", "pending", "overdue", "draft", "approved", "rejected", "posted"].map(
            (value) => (
              <Status key={value} value={value} />
            ),
          )}
        </div>
      </Panel>
    </Section>
  );
}

export function TablesSection(): React.JSX.Element {
  const { t, open } = usePreview();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [selected, setSelected] = useState<Invoice[]>([]);
  const [columns, setColumns] = useState(["date", "status"]);
  const [first, setFirst] = useState(0);
  const rows = INVOICES.filter(
    (r) =>
      (status === "all" || r.status === status) &&
      `${r.id} ${t(r.client)}`.toLowerCase().includes(search.toLowerCase()),
  );
  function exportRows(): void {
    downloadText(
      "markaz-preview-invoices.csv",
      `\uFEFF${[t("number"), t("customer"), t("status"), t("amount")].join(",")}\r\n${(selected.length ? selected : rows).map((r) => [r.id, t(r.client), t(r.status), money(r.amount).replaceAll(",", "")].map((v) => `"${v.replaceAll('"', '""')}"`).join(",")).join("\r\n")}`,
      "text/csv;charset=utf-8",
    );
  }
  return (
    <Section id="tables">
      <Panel className="rd-table-panel">
        <div className="rd-table-title">
          <div>
            <h3>{t("invoices")}</h3>
            <span className="rd-count">{INVOICES.length}</span>
          </div>
          <B
            label={t("newInvoice")}
            icon="pi pi-plus"
            onClick={() =>
              document.getElementById("documents")?.scrollIntoView({ behavior: "instant" })
            }
          />
        </div>
        <div className="rd-tab-strip" aria-label={t("status")}>
          {["all", "paid", "pending", "overdue", "draft"].map((key) => (
            <button
              type="button"
              key={key}
              aria-pressed={status === key}
              onClick={() => {
                setStatus(key);
                setFirst(0);
                setSelected([]);
              }}
            >
              {t(key)}
              <small>
                {key === "all" ? INVOICES.length : INVOICES.filter((r) => r.status === key).length}
              </small>
            </button>
          ))}
        </div>
        <div className="rd-table-tools">
          <div className="rd-search-field">
            <Icon name="search" />
            <InputText
              value={search}
              aria-label={t("searchInvoices")}
              placeholder={t("searchInvoices")}
              onChange={(e) => {
                setSearch(e.target.value);
                setFirst(0);
                setSelected([]);
              }}
            />
          </div>
          <div className="rd-wrap">
            <MultiSelect
              value={columns}
              options={["date", "status"].map((value) => ({ value, label: t(value) }))}
              onChange={(e) => setColumns(e.value as string[])}
              selectedItemsLabel={t("columns")}
              maxSelectedLabels={0}
              placeholder={t("columns")}
              aria-label={t("columns")}
            />
            <B label={t("export")} icon="pi pi-download" outlined onClick={exportRows} />
          </div>
        </div>
        {selected.length ? (
          <div className="rd-bulk" role="status">
            <strong>
              {selected.length} {t("selectedRows")}
            </strong>
            <B label={t("export")} text onClick={exportRows} />
            <B label={t("clear")} text onClick={() => setSelected([])} />
          </div>
        ) : null}
        <DataTable
          value={rows}
          dataKey="id"
          selectionMode="checkbox"
          selection={selected}
          onSelectionChange={(e) => setSelected(e.value)}
          paginator
          rows={5}
          first={first}
          onPage={(e) => setFirst(e.first)}
          paginatorTemplate="FirstPageLink PrevPageLink PageLinks NextPageLink LastPageLink CurrentPageReport"
          currentPageReportTemplate={`{first}–{last} / {totalRecords} ${t("results")}`}
          emptyMessage={
            <div className="rd-empty-inline">
              <Icon name="search" />
              <p>{t("noResults")}</p>
              <B
                label={t("clearFilters")}
                text
                onClick={() => {
                  setSearch("");
                  setStatus("all");
                }}
              />
            </div>
          }
          tableStyle={{ minWidth: "42rem" }}
          removableSort
        >
          <Column selectionMode="multiple" headerStyle={{ width: "3rem" }} />
          <Column
            field="id"
            header={t("number")}
            sortable
            body={(row: Invoice) => (
              <button type="button" className="rd-table-link" onClick={() => open("drawer", row)}>
                <bdi>{row.id}</bdi>
              </button>
            )}
          />
          <Column
            field="client"
            header={t("customer")}
            sortable
            body={(row: Invoice) => (
              <div className="rd-client">
                <span className="rd-avatar">{t(row.client).slice(0, 1)}</span>
                <span>{t(row.client)}</span>
              </div>
            )}
          />
          {columns.includes("date") ? (
            <Column
              field="date"
              header={t("date")}
              sortable
              body={(row: Invoice) => <bdi className="rd-muted">{row.date}</bdi>}
            />
          ) : null}
          {columns.includes("status") ? (
            <Column
              field="status"
              header={t("status")}
              sortable
              body={(row: Invoice) => <Status value={row.status} />}
            />
          ) : null}
          <Column
            field="amount"
            header={t("amount")}
            sortable
            body={(row: Invoice) => <Amount value={row.amount} />}
          />
          <Column
            header={t("more")}
            body={(row: Invoice) => (
              <B
                icon="pi pi-ellipsis-h"
                text
                aria-label={`${t("openDetails")} ${row.id}`}
                onClick={() => open("drawer", row)}
              />
            )}
          />
        </DataTable>
      </Panel>
    </Section>
  );
}

interface Line {
  id: number;
  product: string;
  quantity: number;
  price: number;
}
export function InvoiceEditor({ inDialog = false }: { inDialog?: boolean }): React.JSX.Element {
  const { t, notify, open } = usePreview();
  const nextId = useRef(3);
  const [lines, setLines] = useState<Line[]>([
    { id: 1, product: "product1", quantity: 10, price: 4500 },
    { id: 2, product: "product2", quantity: 4, price: 65000 },
  ]);
  const [saved, setSaved] = useState(false);
  const [client, setClient] = useState("client1");
  const [warehouse, setWarehouse] = useState("mainWarehouse");
  const [date, setDate] = useState("2026-11-15");
  const subtotal = lines.reduce((sum, line) => sum + line.quantity * line.price, 0);
  const tax = Math.round((subtotal * 15) / 100);
  const total = subtotal + tax;
  const update = (id: number, field: "price" | "quantity", value: number) => {
    setSaved(false);
    setLines((items) => items.map((line) => (line.id === id ? { ...line, [field]: value } : line)));
  };
  return (
    <div className="rd-invoice">
      <div className="rd-invoice-head">
        <div>
          <span className="rd-overline">{t("invoice")}</span>
          <h3>
            <bdi>INV-2026-0149</bdi>
          </h3>
        </div>
        <Status value="draft" />
      </div>
      {!inDialog ? (
        <div className="rd-form-grid rd-form-grid-three rd-invoice-fields">
          <DemoField field="customer" required onChange={setClient} />
          <DemoField field="warehouse" required onChange={setWarehouse} />
          <DemoField field="date" onChange={setDate} />
          <DemoField field="dueDate" />
          <DemoField field="paymentTerms" />
          <DemoField field="code" readOnly />
        </div>
      ) : null}
      <div className="rd-line-heading">
        <h4>{t("lineItems")}</h4>
        <span>
          {lines.length} {t("results")}
        </span>
      </div>
      <div className="rd-table-scroll">
        <table className="rd-native-table rd-line-table">
          <thead>
            <tr>
              {["product", "quantity", "price", "total", "more"].map((key) => (
                <th key={key}>{t(key)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.id}>
                <td>
                  <Dropdown
                    value={line.product}
                    options={["product1", "product2", "product3"].map((value) => ({
                      value,
                      label: t(value),
                    }))}
                    aria-label={`${t("product")} ${line.id}`}
                    onChange={(e) => {
                      setSaved(false);
                      setLines((items) =>
                        items.map((item) =>
                          item.id === line.id ? { ...item, product: e.value as string } : item,
                        ),
                      );
                    }}
                  />
                </td>
                <td>
                  <InputNumber
                    value={line.quantity}
                    min={1}
                    max={10000}
                    maxFractionDigits={0}
                    aria-label={`${t("quantity")} ${line.id}`}
                    onValueChange={(e) => update(line.id, "quantity", e.value ?? 1)}
                    locale="en-US"
                  />
                </td>
                <td>
                  <InputNumber
                    value={line.price / 100}
                    min={0}
                    max={999999}
                    minFractionDigits={2}
                    maxFractionDigits={2}
                    aria-label={`${t("price")} ${line.id}`}
                    onValueChange={(e) =>
                      update(line.id, "price", Math.round((e.value ?? 0) * 100))
                    }
                    locale="en-US"
                  />
                </td>
                <td>
                  <Amount value={line.price * line.quantity} />
                </td>
                <td>
                  <B
                    icon="pi pi-trash"
                    text
                    severity="secondary"
                    aria-label={`${t("removeLine")} ${line.id}`}
                    disabled={lines.length === 1}
                    onClick={() => {
                      setSaved(false);
                      setLines((items) => items.filter((item) => item.id !== line.id));
                    }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <B
        label={t("addLine")}
        text
        icon="pi pi-plus"
        onClick={() => {
          setSaved(false);
          setLines((items) => [
            ...items,
            { id: nextId.current++, product: "product3", quantity: 1, price: 2500 },
          ]);
        }}
      />
      <div className="rd-invoice-bottom">
        <div>
          <DemoField field="notes" />
          <div className="rd-inline-hint">
            <Icon name={saved ? "check-circle" : "cloud"} />
            <span aria-live="polite">{t(saved ? "draftSaved" : "draftHint")}</span>
          </div>
        </div>
        <dl className="rd-totals">
          <div>
            <dt>{t("subtotal")}</dt>
            <dd>
              <Amount value={subtotal} />
            </dd>
          </div>
          <div>
            <dt>{t("tax")}</dt>
            <dd>
              <Amount value={tax} />
            </dd>
          </div>
          <div className="rd-total">
            <dt>{t("total")}</dt>
            <dd>
              <Amount value={total} />
            </dd>
          </div>
        </dl>
      </div>
      {!inDialog ? (
        <div className="rd-document-footer">
          <B
            label={t("print")}
            text
            icon="pi pi-print"
            onClick={() =>
              open("viewer", {
                ...INVOICES[0]!,
                id: "INV-2026-0149",
                amount: total,
                status: "draft",
                client,
                warehouse,
                date,
              })
            }
          />
          <div className="rd-wrap">
            <B
              label={t("saveDraft")}
              outlined
              icon="pi pi-save"
              onClick={() => {
                setSaved(true);
                notify(t("draftSaved"));
              }}
            />
            <B
              label={t("post")}
              icon="pi pi-check"
              onClick={() =>
                open("post", {
                  ...INVOICES[0]!,
                  id: "INV-2026-0149",
                  amount: total,
                  status: "draft",
                  client,
                  warehouse,
                  date,
                })
              }
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
export function DocumentsSection(): React.JSX.Element {
  return (
    <Section id="documents">
      <Panel className="rd-document-panel">
        <InvoiceEditor />
      </Panel>
    </Section>
  );
}

export function JournalSample(): React.JSX.Element {
  const { t } = usePreview();
  return (
    <>
      <div className="rd-table-scroll">
        <table className="rd-native-table">
          <thead>
            <tr>
              {["account", "debit", "creditAmount"].map((key) => (
                <th key={key}>{t(key)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <bdi>1101</bdi> · {t("cash")}
              </td>
              <td>
                <Amount value={1265000} />
              </td>
              <td>—</td>
            </tr>
            <tr>
              <td>
                <bdi>1201</bdi> · {t("receivables")}
              </td>
              <td>—</td>
              <td>
                <Amount value={1265000} />
              </td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <th>{t("total")}</th>
              <td>
                <Amount value={1265000} />
              </td>
              <td>
                <Amount value={1265000} />
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="rd-balanced">
        <Icon name="check-circle" />
        {t("balanced")}
      </div>
    </>
  );
}
export function AccountingSection(): React.JSX.Element {
  const { t, open } = usePreview();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ "1": true, "1-1": true });
  const [allocation, setAllocation] = useState(7500);
  const nodes = [
    {
      key: "1",
      data: { code: "1000", name: t("assets"), amount: 39198400 },
      children: [
        {
          key: "1-1",
          data: { code: "1100", name: t("currentAssets"), amount: 39198400 },
          children: [
            { key: "1-1-1", data: { code: "1101", name: t("cash"), amount: 9840000 } },
            { key: "1-1-2", data: { code: "1102", name: t("bank"), amount: 29358400 } },
          ],
        },
      ],
    },
    {
      key: "2",
      data: { code: "2000", name: t("liabilities"), amount: 3428000 },
      children: [{ key: "2-1", data: { code: "2100", name: t("payable"), amount: 3428000 } }],
    },
  ];
  return (
    <Section id="accounting">
      <div className="rd-two-col">
        <Panel
          title={t("accountTree")}
          aside={<B icon="pi pi-plus" text aria-label={t("add")} onClick={() => open("account")} />}
        >
          <TreeTable
            value={nodes}
            expandedKeys={expanded}
            onToggle={(e) => setExpanded(e.value)}
            tableStyle={{ minWidth: "32rem" }}
          >
            <Column field="name" header={t("account")} expander />
            <Column field="code" header={t("code")} />
            <Column
              header={t("balanceValue")}
              body={(node: { data: { amount: number } }) => <Amount value={node.data.amount} />}
            />
          </TreeTable>
          <B
            label={t("dialog.moveAccount")}
            icon="pi pi-arrows-alt"
            text
            onClick={() => open("moveAccount")}
          />
        </Panel>
        <Panel title={t("journal")} aside={<Status value="posted" />}>
          <JournalSample />
          <div className="rd-allocation">
            <div className="rd-panel-heading">
              <h4>{t("allocation")}</h4>
              <span className="rd-small">
                <bdi>{money(allocation * 100)}</bdi> / 12,650
              </span>
            </div>
            <InputNumber
              value={allocation}
              min={0}
              max={12650}
              locale="en-US"
              aria-label={t("allocated")}
              onValueChange={(e) => setAllocation(e.value ?? 0)}
            />
            <progress value={allocation} max={12650} aria-label={t("allocated")} />
            <div className="rd-between">
              <span>{t("remaining")}</span>
              <Amount value={1265000 - allocation * 100} />
            </div>
          </div>
        </Panel>
      </div>
      <Panel className="rd-report">
        <TabView>
          <TabPanel header={t("income")}>
            <div className="rd-report-grid">
              {[
                ["revenue", 12845000],
                ["expenses", 7832000],
                ["net", 5013000],
              ].map(([key, value]) => (
                <div key={key}>
                  <span>{t(String(key))}</span>
                  <strong>
                    <Amount value={Number(value)} />
                  </strong>
                </div>
              ))}
            </div>
          </TabPanel>
          <TabPanel header={t("balanceSheet")}>
            <div className="rd-report-grid">
              {[
                ["assets", 39198400],
                ["liabilities", 3428000],
                ["balanceValue", 35770400],
              ].map(([key, value]) => (
                <div key={key}>
                  <span>{t(String(key))}</span>
                  <strong>
                    <Amount value={Number(value)} />
                  </strong>
                </div>
              ))}
            </div>
          </TabPanel>
        </TabView>
      </Panel>
    </Section>
  );
}
