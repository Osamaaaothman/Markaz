import { createContext, useContext, useId, useState, type ReactNode } from "react";
import { Button, type ButtonProps } from "primereact/button";
import { InputText } from "primereact/inputtext";
import { InputTextarea } from "primereact/inputtextarea";
import { InputNumber } from "primereact/inputnumber";
import { Dropdown } from "primereact/dropdown";
import { Calendar } from "primereact/calendar";
import { Password } from "primereact/password";
import { Tag } from "primereact/tag";
import { copy } from "./copy";
import { money, type Invoice, type StyleId } from "./catalog";

export interface PreviewContextValue {
  lang: "ar" | "en";
  style: StyleId;
  motion: boolean;
  selectStyle: (style: StyleId) => void;
  t: (key: string) => string;
  open: (id: string, invoice?: Invoice) => void;
  notify: (message?: string, severity?: "success" | "info" | "warn" | "error") => void;
}
export const PreviewContext = createContext<PreviewContextValue | null>(null);
export function usePreview(): PreviewContextValue {
  const context = useContext(PreviewContext);
  if (!context) throw new Error("Preview context is required");
  return context;
}
export function translate(lang: "ar" | "en", key: string): string {
  return copy[key]?.[lang === "ar" ? 1 : 0] ?? key;
}
export function Icon({ name }: { name: string }): React.JSX.Element {
  return <i className={`pi pi-${name}`} aria-hidden="true" />;
}
export function B(props: ButtonProps): React.JSX.Element {
  return <Button type="button" {...props} />;
}
export function Section({
  id,
  children,
  count,
}: {
  id: string;
  children: ReactNode;
  count?: number;
}): React.JSX.Element {
  const { t } = usePreview();
  return (
    <section id={id} className="rd-section" aria-labelledby={`${id}-title`}>
      <header className="rd-section-heading">
        <div>
          <div className="rd-overline">
            {t("lab")}
            <span>/</span>
            {String(
              [
                "dashboard",
                "actions",
                "fields",
                "tables",
                "documents",
                "accounting",
                "navigation",
                "dialogs",
                "feedback",
                "files",
                "foundations",
                "recommendation",
              ].indexOf(id) + 1,
            ).padStart(2, "0")}
          </div>
          <h2 id={`${id}-title`} tabIndex={-1}>
            {t(id)} {count ? <span className="rd-count">{count}</span> : null}
          </h2>
          <p>{t(`${id}Note`)}</p>
        </div>
      </header>
      {children}
    </section>
  );
}
export function Panel({
  title,
  children,
  className = "",
  aside,
}: {
  title?: string;
  children: ReactNode;
  className?: string;
  aside?: ReactNode;
}): React.JSX.Element {
  return (
    <div className={`rd-panel ${className}`}>
      {title ? (
        <div className="rd-panel-heading">
          <h3>{title}</h3>
          {aside}
        </div>
      ) : null}
      {children}
    </div>
  );
}
export function Amount({ value }: { value: number }): React.JSX.Element {
  const { t } = usePreview();
  return (
    <span className="rd-money">
      <bdi dir="ltr">{money(value)}</bdi> <small>{t("currency")}</small>
    </span>
  );
}
export function Status({ value }: { value: string }): React.JSX.Element {
  const { t } = usePreview();
  const severity: Record<string, "success" | "warning" | "danger" | "info" | "secondary"> = {
    paid: "success",
    approved: "success",
    posted: "success",
    pending: "warning",
    overdue: "danger",
    rejected: "danger",
    draft: "secondary",
    active: "success",
  };
  return (
    <Tag
      value={t(value)}
      severity={severity[value] ?? "info"}
      icon={`pi pi-${["paid", "approved", "posted", "active"].includes(value) ? "check-circle" : value === "overdue" ? "clock" : value === "draft" ? "pencil" : "circle-fill"}`}
    />
  );
}
const NUMBER_FIELDS = new Set([
  "amount",
  "price",
  "quantity",
  "taxRate",
  "salary",
  "openingBalance",
  "debit",
  "creditAmount",
]);
const SELECT_FIELDS = new Set([
  "customer",
  "supplier",
  "party",
  "warehouse",
  "employee",
  "account",
  "targetAccount",
  "parentAccount",
  "type",
  "role",
  "department",
  "paymentTerms",
  "unit",
  "allowance",
]);
export function DemoField({
  field,
  required = false,
  disabled = false,
  readOnly = false,
  context,
  onChange,
}: {
  field: string;
  required?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  context?: string;
  onChange?: (value: string) => void;
}): React.JSX.Element {
  const { t, lang } = usePreview();
  const id = useId();
  const defaults: Record<string, string> = {
    name: t("client1"),
    nameAr: "شركة النور التجارية",
    nameEn: "Al Noor Trading",
    code: "MK-0148",
    email: "hello@example.com",
    recipient: "hello@example.com",
    phone: "+966 50 000 0000",
    taxNumber: "300000000000003",
    subject: t("emailSubject"),
    message: t("emailBody"),
    address: t("mainWarehouse"),
    job: t("accountant"),
    unitName: "Markaz · 01",
    serial: "MK-EGS-001",
  };
  const entityKey =
    context === "warehouse"
      ? "mainWarehouse"
      : context === "item"
        ? "product1"
        : context === "employee" || context === "user"
          ? "employeeName"
          : context === "account"
            ? "assets"
            : context === "allowanceType"
              ? "housing"
              : context === "taxCode"
                ? "vatStandard"
                : "client1";
  if (["name", "nameAr", "nameEn"].includes(field) && context)
    defaults[field] =
      field === "nameAr"
        ? translate("ar", entityKey)
        : field === "nameEn"
          ? translate("en", entityKey)
          : t(entityKey);
  const [value, setValue] = useState(defaults[field] ?? "");
  const [number, setNumber] = useState<number | null>(
    field === "taxRate" ? 15 : field === "quantity" ? 1 : 1500,
  );
  const [date, setDate] = useState<Date | null>(new Date(2026, 10, 15));
  const options =
    field === "warehouse"
      ? ["mainWarehouse", "northWarehouse"]
      : ["customer", "supplier", "party"].includes(field)
        ? ["client1", "client2", "client3"]
        : field === "employee"
          ? ["employeeName"]
          : ["account", "targetAccount", "parentAccount"].includes(field)
            ? ["cash", "bank", "receivables", "payable"]
            : field === "role"
              ? ["accountant", "manager", "viewer"]
              : field === "department"
                ? ["finance", "sales", "inventory"]
                : field === "paymentTerms"
                  ? ["days30", "cashMethod"]
                  : field === "allowance"
                    ? ["housing", "allowance"]
                    : field === "unit"
                      ? ["piece", "box", "pack"]
                      : context === "party"
                        ? ["customer", "supplier", "employee"]
                        : context === "account"
                          ? ["assets", "liabilities", "revenue", "expenses"]
                          : context === "allowanceType"
                            ? ["fixed", "variable"]
                            : ["active", "inactive"];
  const [selected, setSelected] = useState(options[0]);
  let input: ReactNode;
  if (NUMBER_FIELDS.has(field))
    input = (
      <InputNumber
        inputId={id}
        value={number}
        onValueChange={(e) => setNumber(e.value ?? null)}
        min={0}
        max={9999999}
        maxFractionDigits={2}
        minFractionDigits={field === "quantity" ? 0 : 2}
        locale="en-US"
        disabled={disabled}
        readOnly={readOnly}
        required={required}
      />
    );
  else if (["date", "dueDate", "period"].includes(field))
    input = (
      <Calendar
        inputId={id}
        value={date}
        onChange={(e) => {
          setDate(e.value ?? null);
          if (e.value)
            onChange?.(
              `${e.value.getFullYear()}-${String(e.value.getMonth() + 1).padStart(2, "0")}-${String(e.value.getDate()).padStart(2, "0")}`,
            );
        }}
        showIcon
        dateFormat="yy-mm-dd"
        view={field === "period" ? "month" : "date"}
        required={required}
        disabled={disabled}
      />
    );
  else if (SELECT_FIELDS.has(field))
    input = (
      <Dropdown
        inputId={id}
        value={selected}
        onChange={(e) => {
          setSelected(e.value as string);
          onChange?.(e.value as string);
        }}
        options={options.map((key) => ({ label: t(key), value: key }))}
        filter
        filterPlaceholder={t("searchCustomer")}
        emptyFilterMessage={t("noResults")}
        disabled={disabled}
        required={required}
      />
    );
  else if (["notes", "reason", "message", "address"].includes(field))
    input = (
      <InputTextarea
        id={id}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={field === "message" ? 4 : 2}
        placeholder={t("notesHint")}
        required={required}
        disabled={disabled}
      />
    );
  else if (field === "password")
    input = (
      <Password
        inputId={id}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        toggleMask
        pt={{
          showIcon: { "aria-label": t("showPassword") },
          hideIcon: { "aria-label": t("hidePassword") },
        }}
        feedback={false}
        required={required}
        autoComplete="new-password"
      />
    );
  else
    input = (
      <InputText
        id={id}
        type={["email", "recipient"].includes(field) ? "email" : "text"}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        required={required}
        readOnly={readOnly}
        disabled={disabled}
        dir={
          ["email", "recipient", "phone", "code", "taxNumber", "serial", "otp", "nameEn"].includes(
            field,
          )
            ? "ltr"
            : lang === "ar"
              ? "rtl"
              : "ltr"
        }
      />
    );
  return (
    <div
      className={`rd-field ${["notes", "message", "address"].includes(field) ? "rd-field-wide" : ""}`}
    >
      <label htmlFor={id}>
        {t(field)}
        {required ? <span className="rd-required"> *</span> : null}
        {readOnly ? <small> · {t("readOnly")}</small> : null}
      </label>
      {input}
    </div>
  );
}
export function downloadText(name: string, text: string, type = "text/plain;charset=utf-8"): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
