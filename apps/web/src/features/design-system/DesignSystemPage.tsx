import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "primereact/button";
import { Calendar } from "primereact/calendar";
import { Checkbox } from "primereact/checkbox";
import { Column } from "primereact/column";
import { DataTable } from "primereact/datatable";
import { Dialog } from "primereact/dialog";
import { Dropdown } from "primereact/dropdown";
import { InputSwitch } from "primereact/inputswitch";
import { InputText } from "primereact/inputtext";
import { SelectButton } from "primereact/selectbutton";
import { Skeleton } from "primereact/skeleton";
import { Tag } from "primereact/tag";
import { MonthlyChart } from "../dashboard/MonthlyChart";
import { AnimatedMoney } from "../../shared/ui/AnimatedMoney";
import { Logo, LogoMark } from "../../shared/ui/Logo";

const BRAND = [
  ["Ink 900", "--mk-ink-900"], ["Ink 700", "--mk-ink-700"], ["Forest 700", "--mk-brand-700"], ["Forest 500", "--mk-brand-500"],
  ["Brass 500", "--mk-brass-500"], ["Brass 300", "--mk-brass-300"],
] as const;
const STATUS = [["Success", "--mk-success"], ["Warning", "--mk-warning"], ["Danger", "--mk-danger"], ["Info", "--mk-info"]] as const;
const SURFACES = [
  ["Background", "--mk-bg"], ["Surface", "--mk-surface"], ["Surface 2", "--mk-surface-2"], ["Border", "--mk-border"],
  ["Text", "--mk-text"], ["Muted", "--mk-text-muted"],
] as const;
const SCALE = [["3xl", "--mk-text-3xl"], ["2xl", "--mk-text-2xl"], ["xl", "--mk-text-xl"], ["lg", "--mk-text-lg"], ["base", "--mk-text-base"], ["sm", "--mk-text-sm"], ["xs", "--mk-text-xs"]] as const;

const SAMPLE_MONTHS = [
  { month: "2026-05", revenue: "4600.0000", expense: "1650.0000" }, { month: "2026-06", revenue: "28800.0000", expense: "23000.0000" },
  { month: "2026-07", revenue: "2900.0000", expense: "6300.0000" }, { month: "2026-08", revenue: "3000.0000", expense: "6760.0000" },
  { month: "2026-09", revenue: "24250.0000", expense: "22500.0000" }, { month: "2026-10", revenue: "7400.0000", expense: "5455.0000" },
];

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <section className="erp-card">
      <h2 className="erp-card__title">{title}</h2>
      {note ? <p className="erp-field__hint" style={{ marginBlockEnd: "1rem" }}>{note}</p> : null}
      {children}
    </section>
  );
}

function Swatches({ items }: { items: readonly (readonly [string, string])[] }): React.JSX.Element {
  return (
    <div className="mk-ds__grid">
      {items.map(([name, variable]) => (
        <div key={variable} className="mk-ds__swatch">
          <div className="mk-ds__chip" style={{ background: `var(${variable})` }} />
          <div className="mk-ds__meta">
            <strong>{name}</strong>
            <code dir="ltr">{variable}</code>
          </div>
        </div>
      ))}
    </div>
  );
}

// The living style guide: every colour, type size, component and motion the product is built from, drawn
// from the same tokens and components the screens use, in the current language, direction and theme.
export function DesignSystemPage(): React.JSX.Element {
  const { t } = useTranslation();
  const [replay, setReplay] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [segment, setSegment] = useState<"a" | "b">("a");
  const [on, setOn] = useState(true);
  const [checked, setChecked] = useState(true);
  const [date, setDate] = useState<Date | null>(new Date());
  const [choice, setChoice] = useState<string | null>("a");

  const rows = [
    { number: "INV-FY2026-000010", customer: "Riyadh Villas Development", status: "pending", amount: "1610.0000" },
    { number: "INV-FY2026-000009", customer: "Al Noor Contracting", status: "paid", amount: "6900.0000" },
    { number: "INV-FY2026-000008", customer: "Mohammed Al Harbi Est.", status: "overdue", amount: "20987.5000" },
    { number: "INV-FY2026-000007", customer: "Najd Finishing Supplies", status: "draft", amount: "3450.0000" },
  ];
  const tag = (status: string): React.JSX.Element => {
    const map: Record<string, ["success" | "warning" | "danger" | "secondary", string]> = {
      paid: ["success", t("ds.tagPaid")], pending: ["warning", t("ds.tagPending")], overdue: ["danger", t("ds.tagOverdue")], draft: ["secondary", t("ds.tagDraft")],
    };
    const [severity, label] = map[status] ?? ["secondary", status];
    return <Tag value={label} severity={severity} />;
  };

  return (
    <div className="erp-page mk-ds">
      <div className="erp-page__header">
        <div>
          <h1 className="erp-page__title">{t("ds.title")}</h1>
          <p className="erp-page__subtitle">{t("ds.subtitle")}</p>
        </div>
      </div>

      <Section title={t("ds.logo")} note={t("ds.logoNote")}>
        <div className="mk-ds__row" style={{ marginBlockEnd: "1rem" }}>
          <Button label={t("ds.replay")} icon="pi pi-replay" outlined onClick={() => setReplay((n) => n + 1)} />
        </div>
        <div className="mk-ds__row">
          <div className="mk-ds__logos mk-ds__logos--dark" key={`d${replay}`}>
            <Logo variant="stacked" size={84} animate name={t("app.name")} tagline={t("app.tagline")} />
            <Logo variant="full" size={52} animate name={t("app.name")} tagline={t("app.tagline")} />
            <LogoMark size={40} animate />
          </div>
          <div className="mk-ds__logos mk-ds__logos--light" key={`l${replay}`}>
            <Logo variant="full" size={52} animate name={t("app.name")} tagline={t("app.tagline")} />
            <LogoMark size={64} animate />
            <LogoMark size={28} />
          </div>
        </div>
      </Section>

      <Section title={t("ds.colors")}>
        <h3 className="erp-form__section-title">{t("ds.brand")}</h3>
        <Swatches items={BRAND} />
        <h3 className="erp-form__section-title" style={{ marginBlockStart: "1.25rem" }}>{t("ds.status")}</h3>
        <Swatches items={STATUS} />
        <h3 className="erp-form__section-title" style={{ marginBlockStart: "1.25rem" }}>{t("ds.neutral")}</h3>
        <Swatches items={SURFACES} />
      </Section>

      <Section title={t("ds.type")} note={t("ds.typeNote")}>
        <div className="mk-ds__type">
          {SCALE.map(([name, variable]) => (
            <div key={name}>
              <small>{name} · {variable}</small>
              <span style={{ fontSize: `var(${variable})`, fontWeight: name === "3xl" || name === "2xl" ? 800 : 500 }}>{t("ds.sample")} · {t(`ds.scale.${name}`)}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title={t("ds.buttons")}>
        <div className="mk-ds__row">
          <Button label={t("ds.primary")} icon="pi pi-check" />
          <Button label={t("ds.outlined")} outlined />
          <Button label={t("ds.text")} text />
          <Button label={t("ds.secondary")} severity="secondary" />
          <Button label={t("ds.danger")} severity="danger" icon="pi pi-trash" />
          <Button label={t("ds.small")} size="small" />
          <Button label={t("ds.loading")} loading />
          <Button label={t("ds.disabled")} disabled />
          <Button icon="pi pi-plus" aria-label={t("ds.iconOnly")} />
          <Button icon="pi pi-pencil" rounded text severity="secondary" aria-label={t("ds.iconOnly")} />
        </div>
      </Section>

      <Section title={t("ds.forms")}>
        <div className="erp-form__row">
          <div className="erp-field">
            <label htmlFor="dsText">{t("ds.textField")}</label>
            <InputText id="dsText" defaultValue="INV-FY2026-000010" />
          </div>
          <div className="erp-field">
            <label htmlFor="dsChoice">{t("ds.dropdownField")}</label>
            <Dropdown inputId="dsChoice" value={choice} onChange={(e) => setChoice(e.value as string)} options={[{ label: "VAT 15%", value: "a" }, { label: "VAT 0%", value: "b" }]} />
          </div>
          <div className="erp-field">
            <label htmlFor="dsDate">{t("ds.dateField")}</label>
            <Calendar inputId="dsDate" value={date} onChange={(e) => setDate(e.value ?? null)} dateFormat="yy-mm-dd" />
          </div>
          <div className="erp-field">
            <label htmlFor="dsInvalid">{t("ds.invalidField")}</label>
            <InputText id="dsInvalid" invalid />
            <span className="erp-field__error">{t("ds.required")}</span>
          </div>
          <div className="erp-field">
            <label htmlFor="dsDisabled">{t("ds.disabledField")}</label>
            <InputText id="dsDisabled" disabled defaultValue="—" />
          </div>
        </div>
        <h3 className="erp-form__section-title" style={{ marginBlock: "1.25rem 0.75rem" }}>{t("ds.switches")}</h3>
        <div className="mk-ds__row">
          <InputSwitch checked={on} onChange={(e) => setOn(Boolean(e.value))} />
          <Checkbox checked={checked} onChange={(e) => setChecked(Boolean(e.checked))} />
          <SelectButton value={segment} onChange={(e: { value: "a" | "b" | null }) => { if (e.value) setSegment(e.value); }} options={[{ label: t("ds.primary"), value: "a" }, { label: t("ds.secondary"), value: "b" }]} allowEmpty={false} />
        </div>
        <h3 className="erp-form__section-title" style={{ marginBlock: "1.25rem 0.75rem" }}>{t("ds.tags")}</h3>
        <div className="mk-ds__row">
          <Tag value={t("ds.tagPaid")} severity="success" />
          <Tag value={t("ds.tagPending")} severity="warning" />
          <Tag value={t("ds.tagOverdue")} severity="danger" />
          <Tag value={t("ds.tagInfo")} severity="info" />
          <Tag value={t("ds.tagDraft")} severity="secondary" />
        </div>
      </Section>

      <Section title={t("ds.cards")}>
        <div className="erp-kpis">
          <button type="button" className="erp-kpi erp-kpi--warn">
            <span className="erp-kpi__icon"><i className="pi pi-arrow-down-left" aria-hidden="true" /></span>
            <span className="erp-kpi__label">{t("ds.owedToYou")}</span>
            <span className="erp-kpi__value"><AnimatedMoney key={replay} amount="77832.5000" currency="SAR" /></span>
            <span className="erp-kpi__hint">{t("ds.overdueNote", { amount: "63,422.50 SAR" })}</span>
          </button>
          <button type="button" className="erp-kpi">
            <span className="erp-kpi__icon"><i className="pi pi-wallet" aria-hidden="true" /></span>
            <span className="erp-kpi__label">{t("dashboard.kpi.cash")}</span>
            <span className="erp-kpi__value"><AnimatedMoney key={replay} amount="391984.0000" currency="SAR" /></span>
          </button>
        </div>
      </Section>

      <Section title={t("ds.data")}>
        <DataTable value={rows} className="erp-table" showGridlines size="small">
          <Column header={t("ds.number")} body={(r: (typeof rows)[number]) => <span className="coa-code">{r.number}</span>} />
          <Column header={t("ds.customer")} field="customer" />
          <Column header={t("ds.status")} body={(r: (typeof rows)[number]) => tag(r.status)} />
          <Column header={t("ds.amount")} align="right" body={(r: (typeof rows)[number]) => <AnimatedMoney key={replay} amount={r.amount} currency="SAR" />} />
        </DataTable>
        <div style={{ marginBlockStart: "1.25rem" }} key={`c${replay}`}>
          <MonthlyChart months={SAMPLE_MONTHS} currency="SAR" />
        </div>
      </Section>

      <Section title={t("ds.feedback")}>
        <div className="mk-ds__row" style={{ alignItems: "stretch" }}>
          <Button label={t("ds.openDialog")} icon="pi pi-window-maximize" outlined onClick={() => setDialogOpen(true)} />
          <div style={{ flex: 1, minWidth: "14rem", display: "grid", gap: "0.5rem" }}>
            <Skeleton height="1.1rem" />
            <Skeleton height="1.1rem" width="70%" />
            <Skeleton height="1.1rem" width="45%" />
          </div>
          <div className="erp-page__empty" style={{ flex: 1, minWidth: "14rem" }}>
            <strong>{t("ds.empty")}</strong>
            <p>{t("ds.emptyBody")}</p>
          </div>
        </div>
        <Dialog header={t("ds.dialogTitle")} visible={dialogOpen} onHide={() => setDialogOpen(false)} className="erp-dialog" modal style={{ width: "min(30rem, 96vw)" }}>
          <p>{t("ds.dialogBody")}</p>
          <div className="erp-form__actions">
            <Button label={t("actions.cancel")} text onClick={() => setDialogOpen(false)} />
            <Button label={t("actions.confirm")} onClick={() => setDialogOpen(false)} />
          </div>
        </Dialog>
      </Section>

      <Section title={t("ds.motion")} note={t("ds.motionNote")}>
        <Button label={t("ds.replay")} icon="pi pi-replay" outlined onClick={() => setReplay((n) => n + 1)} />
      </Section>

      <Section title={t("ds.keyboard")}>
        <ul className="erp-attention">
          <li><span className="erp-attention__item"><kbd>Ctrl</kbd> <kbd>K</kbd><span>{t("ds.kbdPalette")}</span></span></li>
          <li><span className="erp-attention__item"><kbd>/</kbd><span>{t("ds.kbdSlash")}</span></span></li>
          <li><span className="erp-attention__item"><kbd>Enter</kbd><span>{t("ds.kbdEnter")}</span></span></li>
          <li><span className="erp-attention__item"><kbd>Esc</kbd><span>{t("ds.kbdEsc")}</span></span></li>
        </ul>
      </Section>
    </div>
  );
}
