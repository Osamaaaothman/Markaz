import { isAxiosError } from "axios";
import { Checkbox } from "primereact/checkbox";
import { Dropdown } from "primereact/dropdown";
import { InputText } from "primereact/inputtext";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { localizedName } from "../../../shared/lib/localized-name";
import { PartyPicker } from "../../accounting/PartyPicker";
import { useAccounts } from "../../accounting/use-accounts";
import { useAllEmployees } from "../../hr/use-hr";
import { useAllItems } from "../../inventory/use-items";
import { useAllWarehouses } from "../../inventory/use-warehouses";
import { useTaxCodes } from "../../purchasing/use-invoicing";
import { fetchItemForm, reviseItem, type ChangeItem, type ChangePreview, type FormSchema } from "../ai-api";
import { valueLabel } from "../value-label";

type Args = Record<string, unknown>;

// Internal links the user never types (a file the user attached, an order line picked by the server).
const HIDDEN = new Set(["sourceFileId", "purchaseOrderLineId"]);

// Fields that name a record: the user picks it from a list instead of typing a code or an id.
type Picker = "party" | "supplier" | "customer" | "account" | "warehouse" | "item" | "tax" | "employee";
const PICKERS: Record<string, Picker> = {
  partyId: "party",
  supplierId: "supplier",
  customerId: "customer",
  cashAccountCode: "account",
  accountCode: "account",
  sourceAccountCode: "account",
  warehouseCode: "warehouse",
  itemCode: "item",
  taxCode: "tax",
  employeeId: "employee",
};

const isDate = (s: FormSchema): boolean => s.pattern === "^\\d{4}-\\d{2}-\\d{2}$";
// A nullable/optional field is an anyOf with null in JSON Schema; the real shape is the other branch.
const shapeOf = (s: FormSchema): FormSchema => s.anyOf?.find((b) => b.type !== "null") ?? s;
const typeOf = (s: FormSchema): string | undefined => (Array.isArray(s.type) ? s.type.find((x) => x !== "null") : s.type);

// Removes fields the user emptied, so an optional field left blank is simply not sent.
function clean(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(clean);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== "" && v !== undefined && v !== null).map(([k, v]) => [k, clean(v)]));
  }
  return value;
}

// Every field of a waiting card, generated from the tool's own input schema: lines, amounts, dates,
// the account, the warehouse, the party, the payment method. Saving sends the whole corrected card to
// the server, which checks it with the same rules as the proposal and returns the new preview.
export function CardEditor({ conversationId, change, onSaved, onClose }: { conversationId: string; change: ChangeItem; onSaved: (args: Args, preview: ChangePreview) => void; onClose: () => void }): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const [schema, setSchema] = useState<FormSchema | null>(null);
  const [values, setValues] = useState<Args>(change.args);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetchItemForm(conversationId, change.key)
      .then((form) => { if (live) { setSchema(form.schema); setValues(form.args); } })
      .catch(() => { if (live) setError("TOOL_FAILED"); });
    return () => { live = false; };
  }, [conversationId, change.key]);

  const save = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      const res = await reviseItem(conversationId, change.key, clean(values) as Args, i18n.language);
      onSaved(res.args, res.preview);
    } catch (e) {
      const code = isAxiosError<{ code?: string }>(e) ? e.response?.data?.code : undefined;
      setError(code ?? "TOOL_FAILED");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="ai-edit">
      {schema ? <Fields schema={schema} value={values} onChange={setValues} /> : !error ? <p className="ai-edit__loading"><i className="pi pi-spin pi-spinner" aria-hidden="true" /></p> : null}
      {error ? <p className="ai-ticket__note ai-ticket__note--danger">{t(`ai.error.${error}`, { defaultValue: t("ai.error.TOOL_FAILED") })}</p> : null}
      <div className="ai-edit__actions">
        <button type="button" className="ai-btn ai-btn--ghost" disabled={saving} onClick={onClose}>{t("ai.change.cancelEdit")}</button>
        <button type="button" className="ai-btn ai-btn--primary" disabled={saving || !schema} onClick={() => void save()}>
          <i className={saving ? "pi pi-spin pi-spinner" : "pi pi-check"} aria-hidden="true" /> {t("ai.change.saveEdit")}
        </button>
      </div>
    </div>
  );
}

function Fields({ schema, value, onChange }: { schema: FormSchema; value: Args; onChange: (next: Args) => void }): React.JSX.Element {
  const props = shapeOf(schema).properties ?? {};
  return (
    <>
      {Object.entries(props).filter(([key]) => !HIDDEN.has(key)).map(([key, sub]) => (
        <Field key={key} name={key} schema={sub} value={value[key]} required={shapeOf(schema).required?.includes(key) ?? false} onChange={(v) => onChange({ ...value, [key]: v })} />
      ))}
    </>
  );
}

function Field({ name, schema, value, required, onChange }: { name: string; schema: FormSchema; value: unknown; required: boolean; onChange: (v: unknown) => void }): React.JSX.Element | null {
  const { t } = useTranslation();
  const uid = useId();
  const label = t(`ai.arg.${name}`, { defaultValue: t(`ai.col.${name}`, { defaultValue: name }) });
  const shape = shapeOf(schema);
  const type = typeOf(shape);

  // A link to another card in this review: kept as is, shown as the card it points to.
  if (typeof value === "string" && value.startsWith("$ref:")) {
    return (
      <div className="ai-edit__field">
        <span>{label}</span>
        <span className="ai-pill"><i className="pi pi-link" aria-hidden="true" /> {t("ai.change.dependsOn", { key: value.slice(5).split(".")[0] })}</span>
      </div>
    );
  }

  if (type === "array" && shape.items) {
    const rows = Array.isArray(value) ? (value as Args[]) : [];
    const item = shapeOf(shape.items);
    if (typeOf(item) !== "object") return null;
    const canAdd = shape.maxItems === undefined || rows.length < shape.maxItems;
    const canRemove = rows.length > (shape.minItems ?? 0);
    return (
      <fieldset className="ai-edit__lines">
        <legend>{label}</legend>
        {rows.map((row, i) => (
          <div key={i} className="ai-edit__line">
            <span className="ai-edit__line-no">{i + 1}</span>
            <div className="ai-edit__line-fields">
              <Fields schema={item} value={row} onChange={(next) => onChange(rows.map((r, ri) => (ri === i ? next : r)))} />
            </div>
            {canRemove ? (
              <button type="button" className="ai-btn ai-btn--ghost ai-btn--danger" aria-label={t("ai.change.removeLine")} onClick={() => onChange(rows.filter((_, ri) => ri !== i))}>
                <i className="pi pi-trash" aria-hidden="true" />
              </button>
            ) : null}
          </div>
        ))}
        {canAdd ? (
          <button type="button" className="ai-btn ai-btn--ghost" onClick={() => onChange([...rows, {}])}>
            <i className="pi pi-plus" aria-hidden="true" /> {t("ai.change.addLine")}
          </button>
        ) : null}
      </fieldset>
    );
  }

  if (type === "object") {
    return (
      <fieldset className="ai-edit__lines">
        <legend>{label}</legend>
        <Fields schema={shape} value={(value as Args | undefined) ?? {}} onChange={onChange} />
      </fieldset>
    );
  }

  const id = `ai-edit-${name}-${uid}`;
  const wrap = (control: React.ReactNode): React.JSX.Element => (
    <div className="ai-edit__field">
      <label htmlFor={id}>{label}{required ? <span aria-hidden="true"> *</span> : null}</label>
      {control}
    </div>
  );

  if (type === "boolean") return wrap(<Checkbox inputId={id} checked={value === true} onChange={(e) => onChange(e.checked === true)} />);
  if (shape.enum) return wrap(<EnumSelect id={id} options={shape.enum.map(String)} value={typeof value === "string" ? value : null} required={required} onChange={onChange} />);

  const picker = PICKERS[name];
  const text = typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
  if (picker === "party" || picker === "supplier" || picker === "customer") {
    return wrap(
      <PartyPicker inputId={id} value={text || null} excludeEmployees {...(picker === "party" ? {} : { kind: picker === "supplier" ? "SUPPLIER" : "CUSTOMER" })} onChange={(p) => onChange(p?.id ?? "")} />,
    );
  }
  if (picker) return wrap(<RecordSelect id={id} kind={picker} value={text} onChange={onChange} />);

  if (type === "number" || type === "integer") {
    return wrap(<InputText id={id} inputMode="numeric" dir="ltr" value={text} onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))} />);
  }
  if (isDate(shape)) return wrap(<InputText id={id} type="date" dir="ltr" value={text} onChange={(e) => onChange(e.target.value)} />);
  return wrap(<InputText id={id} value={text} onChange={(e) => onChange(e.target.value)} />);
}

function EnumSelect({ id, options, value, required, onChange }: { id: string; options: string[]; value: string | null; required: boolean; onChange: (v: unknown) => void }): React.JSX.Element {
  const { i18n } = useTranslation();
  return <Dropdown inputId={id} value={value} options={options.map((o) => ({ label: valueLabel(i18n, o), value: o }))} showClear={!required} onChange={(e) => onChange(e.value ?? "")} />;
}

// Accounts, warehouses, items, tax codes and employees, from the same lists the document forms use.
// If the user may not read that list, a plain text field is shown instead.
function RecordSelect({ id, kind, value, onChange }: { id: string; kind: Exclude<Picker, "party" | "supplier" | "customer">; value: string; onChange: (v: unknown) => void }): React.JSX.Element {
  const { i18n } = useTranslation();
  const accounts = useAccounts();
  const warehouses = useAllWarehouses();
  const items = useAllItems();
  const taxes = useTaxCodes(false);
  const employees = useAllEmployees();
  const name = (r: { name: string; nameAr: string | null }): string => localizedName(r, i18n.language);
  const options: Array<{ label: string; value: string }> | undefined =
    kind === "account" ? accounts.data?.map((a) => ({ label: `${a.code} ${name(a)}`, value: a.code }))
    : kind === "warehouse" ? warehouses.data?.map((w) => ({ label: `${w.code} ${name(w)}`, value: w.code }))
    : kind === "item" ? items.data?.map((it) => ({ label: `${it.code} ${name(it)}`, value: it.code }))
    : kind === "tax" ? taxes.data?.map((tx) => ({ label: name(tx), value: tx.code }))
    : employees.data?.map((e) => ({ label: `${e.ref} ${name(e)}`, value: e.id }));
  if (!options) return <InputText id={id} dir="ltr" value={value} onChange={(e) => onChange(e.target.value)} />;
  // Keep the current value selectable even if it is not in the list (e.g. an inactive record).
  const all = value && !options.some((o) => o.value === value) ? [{ label: value, value }, ...options] : options;
  return <Dropdown inputId={id} value={value || null} options={all} filter showClear onChange={(e) => onChange(e.value ?? "")} />;
}
