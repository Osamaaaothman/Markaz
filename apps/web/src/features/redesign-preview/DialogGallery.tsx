import { useId, useState } from "react";
import { Dialog } from "primereact/dialog";
import { InputText } from "primereact/inputtext";
import { InputNumber } from "primereact/inputnumber";
import { Checkbox } from "primereact/checkbox";
import { Dropdown } from "primereact/dropdown";
import { Steps } from "primereact/steps";
import { DIALOGS, INVOICES, SECTIONS, STYLES, type DialogSpec, type Invoice } from "./catalog";
import { ActivityTrail, FileDrop, FileList } from "./ExperienceSections";
import { JournalSample } from "./WorkSections";
import { Amount, B, DemoField, Icon, Panel, Section, Status, usePreview } from "./ui";

export function DialogGallery(): React.JSX.Element {
  const { t, open } = usePreview();
  const [search, setSearch] = useState("");
  const [group, setGroup] = useState("all");
  const filtered = DIALOGS.filter(
    (d) =>
      (group === "all" || d.group === group) &&
      `${t(`dialog.${d.id}`)} ${t(d.group)} ${d.id}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <Section id="dialogs" count={DIALOGS.length}>
      <div className="rd-catalog-tools">
        <div className="rd-search-field">
          <Icon name="search" />
          <InputText
            aria-label={t("searchDialogs")}
            placeholder={t("searchDialogs")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Dropdown
          value={group}
          onChange={(e) => setGroup(e.value as string)}
          options={[
            "all",
            "shared",
            "sales",
            "purchasing",
            "inventory",
            "accounting",
            "hr",
            "settings",
            "compliance",
          ].map((value) => ({ value, label: t(value === "all" ? "allGroups" : value) }))}
          aria-label={t("allGroups")}
        />
        <span className="rd-muted">
          <bdi>
            {filtered.length} / {DIALOGS.length}
          </bdi>
        </span>
      </div>
      <div className="rd-dialog-grid">
        {filtered.map((d, index) => (
          <button
            type="button"
            key={d.id}
            className="rd-dialog-tile"
            data-dialog-id={d.id}
            onClick={() => open(d.id)}
          >
            <div className="rd-dialog-tile-top">
              <span className="rd-icon-tile">
                <Icon name={d.icon} />
              </span>
              <span className="rd-tile-number">{String(index + 1).padStart(2, "0")}</span>
            </div>
            <strong>{t(`dialog.${d.id}`)}</strong>
            <div>
              <span>
                {t(d.group)}
                {d.source === "proposed" ? ` · ${t("newPattern")}` : ""}
              </span>
              <Icon name="arrow-up-left" />
            </div>
          </button>
        ))}
      </div>
      {!filtered.length ? (
        <Panel>
          <p>{t("noResults")}</p>
          <B
            label={t("clearFilters")}
            text
            onClick={() => {
              setSearch("");
              setGroup("all");
            }}
          />
        </Panel>
      ) : null}
    </Section>
  );
}

function RolesBody(): React.JSX.Element {
  const { t } = usePreview();
  const [permissions, setPermissions] = useState([
    "sales-read",
    "sales-create",
    "accounting-read",
    "inventory-read",
  ]);
  return (
    <>
      <DemoField field="role" required />
      <div className="rd-table-scroll">
        <table className="rd-native-table rd-permissions">
          <thead>
            <tr>
              <th>{t("roles")}</th>
              {["read", "create", "approve"].map((key) => (
                <th key={key}>{t(key)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {["sales", "purchasing", "inventory", "accounting", "hr"].map((group) => (
              <tr key={group}>
                <th>{t(group)}</th>
                {["read", "create", "approve"].map((action) => {
                  const id = `${group}-${action}`;
                  return (
                    <td key={action}>
                      <Checkbox
                        inputId={id}
                        aria-label={`${t(group)} · ${t(action)}`}
                        checked={permissions.includes(id)}
                        onChange={(e) =>
                          setPermissions((items) =>
                            e.checked ? [...items, id] : items.filter((v) => v !== id),
                          )
                        }
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
function DialogLines({ spec }: { spec: DialogSpec }): React.JSX.Element {
  const { t } = usePreview();
  const [selected, setSelected] = useState([0, 1]);
  const [quantities, setQuantities] = useState([2, 1, 3]);
  const isReturn = spec.id.toLowerCase().includes("return");
  const isAllowance = spec.id === "allowances";
  const isRequest = spec.id === "accepted";
  const isReplenish = spec.id === "replenishment";
  return (
    <>
      <div className="rd-form-grid">
        {spec.fields.map((field) => (
          <DemoField key={field} field={field} context={spec.id} required={field === "warehouse"} />
        ))}
      </div>
      <div className="rd-table-scroll">
        <table className="rd-native-table">
          <thead>
            <tr>
              <th>
                <span className="rd-sr-only">{t("selectedRows")}</span>
              </th>
              <th>{t(isAllowance ? "allowance" : isRequest ? "number" : "product")}</th>
              <th>{t(isAllowance ? "amount" : isReplenish ? "onHand" : "quantity")}</th>
              <th>
                {t(
                  isReturn
                    ? "returnQuantity"
                    : isAllowance
                      ? "amount"
                      : isReplenish
                        ? "requested"
                        : spec.id === "receive"
                          ? "received"
                          : "quantity",
                )}
              </th>
            </tr>
          </thead>
          <tbody>
            {[0, 1, 2].map((index) => (
              <tr key={index}>
                <td>
                  <Checkbox
                    checked={selected.includes(index)}
                    aria-label={`${t("add")} ${index + 1}`}
                    onChange={(e) =>
                      setSelected((items) =>
                        e.checked ? [...items, index] : items.filter((v) => v !== index),
                      )
                    }
                  />
                </td>
                <td>
                  {isRequest ? (
                    <bdi>PR-2026-00{index + 1}</bdi>
                  ) : (
                    t(isAllowance ? (index === 0 ? "housing" : "allowance") : `product${index + 1}`)
                  )}
                </td>
                <td>
                  <bdi>{isAllowance ? "1,500.00" : [10, 8, 12][index]}</bdi>
                </td>
                <td>
                  <InputNumber
                    value={quantities[index] ?? 0}
                    min={0}
                    max={isReturn ? ([10, 8, 12][index] ?? 0) : 10000}
                    locale="en-US"
                    aria-label={`${t("quantity")} ${index + 1}`}
                    onValueChange={(e) =>
                      setQuantities((values) =>
                        values.map((v, i) => (i === index ? (e.value ?? 0) : v)),
                      )
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="rd-inline-hint">
        <Icon name="info-circle" />
        {selected.length} {t("selectedRows")}
      </div>
    </>
  );
}
function ImportBody({ onDone }: { onDone: () => void }): React.JSX.Element {
  const { t } = usePreview();
  const [step, setStep] = useState(0);
  const [sample, setSample] = useState(false);
  const [mapping, setMapping] = useState(["name", "amount", "code"]);
  return (
    <>
      <Steps
        model={["uploadStep", "mappingStep", "validationStep"].map((key) => ({ label: t(key) }))}
        activeIndex={step}
      />
      <p className="rd-dialog-note">{t("importHint")}</p>
      {step === 0 ? (
        <div className="rd-import-sample">
          <Icon name="file-excel" />
          <h3>markaz-sample.csv</h3>
          <p>{t("validRows")}</p>
          <B
            outlined
            label={t(sample ? "success" : "importSample")}
            icon={`pi pi-${sample ? "check" : "upload"}`}
            onClick={() => setSample(true)}
          />
        </div>
      ) : step === 1 ? (
        <div className="rd-mapping">
          {["sourceColumnName", "sourceColumnAmount", "sourceColumnCode"].map((key, index) => (
            <div key={key}>
              <span>{t(key)}</span>
              <Icon name="arrow-left" />
              <Dropdown
                value={mapping[index]}
                options={["name", "amount", "code"].map((value) => ({ value, label: t(value) }))}
                aria-label={`${t("columnTarget")} ${index + 1}`}
                onChange={(e) =>
                  setMapping((v) => v.map((val, i) => (i === index ? (e.value as string) : val)))
                }
              />
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="rd-balanced">
            <Icon name="check-circle" />
            {t("validRows")}
          </div>
          <div className="rd-table-scroll">
            <table className="rd-native-table">
              <thead>
                <tr>
                  {mapping.map((key) => (
                    <th key={key}>{t(key)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[1, 2, 3].map((n) => (
                  <tr key={n}>
                    {mapping.map((key) => (
                      <td key={key}>
                        {key === "name"
                          ? t(`client${n}`)
                          : key === "code"
                            ? `C-00${n}`
                            : "1,500.00"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <div className="rd-modal-actions">
        <B label={t("previous")} text disabled={step === 0} onClick={() => setStep((s) => s - 1)} />
        <B
          label={t(step === 2 ? "confirm" : "next")}
          disabled={!sample || (step === 1 && new Set(mapping).size !== 3)}
          onClick={() => (step === 2 ? onDone() : setStep((s) => s + 1))}
        />
      </div>
    </>
  );
}
function OnboardingBody({ onDone }: { onDone: () => void }): React.JSX.Element {
  const { t, notify } = usePreview();
  const [step, setStep] = useState(0);
  const [otp, setOtp] = useState("");
  return (
    <>
      <span className="rd-demo-chip">
        <Icon name="shield" />
        {t("sandbox")}
      </span>
      <Steps
        model={["certificate", "checks", "activation"].map((key) => ({ label: t(key) }))}
        activeIndex={step}
      />
      <div className="rd-step-content">
        <Icon name={step === 0 ? "key" : step === 1 ? "verified" : "check-circle"} />
        <h3>{t(["certificate", "checks", "activation"][step]!)}</h3>
        <p>{t("localOnly")}</p>
      </div>
      {step === 0 ? (
        <div className="rd-field">
          <label htmlFor="onboarding-otp">{t("otp")}</label>
          <InputText
            id="onboarding-otp"
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="123456"
            inputMode="numeric"
            dir="ltr"
          />
        </div>
      ) : (
        <div className="rd-balanced">
          <Icon name="check-circle" />
          {t("stepPreview")}
        </div>
      )}
      <div className="rd-modal-actions">
        <B
          label={t(step === 2 ? "done" : "next")}
          disabled={step === 0 && otp.length !== 6}
          onClick={() => {
            if (step === 2) onDone();
            else {
              setStep((s) => s + 1);
              notify(t("stepPreview"));
            }
          }}
        />
      </div>
    </>
  );
}
function CommandBody({ onHide }: { onHide: () => void }): React.JSX.Element {
  const { t } = usePreview();
  const [search, setSearch] = useState("");
  const entries = SECTIONS.filter(([id]) =>
    `${t(id)} ${id}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <>
      <div className="rd-search-field rd-command-search">
        <Icon name="search" />
        <InputText
          autoFocus
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("search")}
          aria-label={t("search")}
        />
      </div>
      <div className="rd-command-list">
        {entries.map(([id, icon]) => (
          <button
            type="button"
            key={id}
            onClick={() => {
              onHide();
              window.setTimeout(() => {
                document.getElementById(id)?.scrollIntoView({ behavior: "instant" });
                document.getElementById(`${id}-title`)?.focus();
              }, 20);
            }}
          >
            <Icon name={icon} />
            <span>{t(id)}</span>
            <Icon name="arrow-up-left" />
          </button>
        ))}
        {!entries.length ? <p>{t("noResults")}</p> : null}
      </div>
      <div className="rd-command-footer">
        <kbd>Tab</kbd> <span>{t("next")}</span>
        <kbd>Enter</kbd> <span>{t("open")}</span>
        <kbd>Esc</kbd> <span>{t("close")}</span>
      </div>
    </>
  );
}
function DetailBody({ spec, invoice }: { spec: DialogSpec; invoice: Invoice }): React.JSX.Element {
  const { t } = usePreview();
  return (
    <>
      <div className="rd-detail-hero">
        <div>
          <span>{t("number")}</span>
          <h3>
            <bdi>{spec.id.includes("journal") ? "JE-2026-0081" : invoice.id}</bdi>
          </h3>
        </div>
        <Status value={invoice.status} />
      </div>
      <dl className="rd-detail-list">
        <div>
          <dt>{t("customer")}</dt>
          <dd>{t(invoice.client)}</dd>
        </div>
        <div>
          <dt>{t("date")}</dt>
          <dd>
            <bdi>{invoice.date}</bdi>
          </dd>
        </div>
        <div>
          <dt>{t("warehouse")}</dt>
          <dd>{t(invoice.warehouse ?? "mainWarehouse")}</dd>
        </div>
        <div>
          <dt>{t("total")}</dt>
          <dd>
            <Amount value={invoice.amount} />
          </dd>
        </div>
      </dl>
      {spec.id === "journalDetail" ? (
        <JournalSample />
      ) : spec.id === "post" ? (
        <div className="rd-notice rd-notice-info">
          <Icon name="info-circle" />
          <p>{t("postNote")}</p>
        </div>
      ) : (
        <>
          <div className="rd-dialog-divider">
            <h4>{t("lineItems")}</h4>
          </div>
          <div className="rd-table-scroll">
            <table className="rd-native-table">
              <thead>
                <tr>
                  <th>{t("product")}</th>
                  <th>{t("quantity")}</th>
                  <th>{t("total")}</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>{t("product1")}</td>
                  <td>10</td>
                  <td>
                    <Amount value={45000} />
                  </td>
                </tr>
                <tr>
                  <td>{t("product2")}</td>
                  <td>4</td>
                  <td>
                    <Amount value={invoice.amount - 45000} />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}
      {spec.kind === "drawer" ? (
        <>
          <h4>{t("activity")}</h4>
          <ActivityTrail />
          <FileList />
        </>
      ) : null}
    </>
  );
}
function PrintBody({ invoice }: { invoice: Invoice }): React.JSX.Element {
  const { t } = usePreview();
  return (
    <div className="rd-print-stage">
      <article className="rd-print-sheet">
        <div className="rd-between">
          <div>
            <h2>{t("brand")}</h2>
            <p>{t("invoice")}</p>
          </div>
          <span className="rd-print-mark">
            <Icon name="compass" />
          </span>
        </div>
        <hr />
        <div className="rd-between">
          <bdi>{invoice.id}</bdi>
          <bdi>{invoice.date}</bdi>
        </div>
        <h3>{t(invoice.client)}</h3>
        <p>{t("mainWarehouse")}</p>
        <table className="rd-native-table">
          <thead>
            <tr>
              <th>{t("product")}</th>
              <th>{t("total")}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{t("product1")}</td>
              <td>
                <Amount value={invoice.amount} />
              </td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <th>{t("total")}</th>
              <td>
                <Amount value={invoice.amount} />
              </td>
            </tr>
          </tfoot>
        </table>
        <p className="rd-print-note">
          {t("demo")} · {t("portrait")}
        </p>
      </article>
    </div>
  );
}
export function PreviewDialog({
  spec,
  invoice,
  onHide,
}: {
  spec: DialogSpec;
  invoice: Invoice | null;
  onHide: () => void;
}): React.JSX.Element {
  const { t, lang, motion, notify, style, selectStyle } = usePreview();
  const id = useId();
  const [complete, setComplete] = useState(false);
  const item = invoice ?? INVOICES[0]!;
  const done = () => {
    setComplete(true);
    notify(t("savingPreview"));
  };
  const large = ["lines", "journal", "roles", "import", "viewer", "audit"].includes(spec.kind);
  const special = ["command", "import", "onboarding"].includes(spec.kind);
  let body: React.ReactNode;
  if (complete || spec.kind === "success")
    body = (
      <div className="rd-success-state">
        <span className="rd-success-emblem">
          <Icon name="check" />
        </span>
        <h3>{t("successTitle")}</h3>
        <p>{t("successBody")}</p>
        <bdi className="rd-success-reference">{item.id}</bdi>
        <dl className="rd-detail-list">
          <div>
            <dt>{t("customer")}</dt>
            <dd>{t(item.client)}</dd>
          </div>
          <div>
            <dt>{t("total")}</dt>
            <dd>
              <Amount value={item.amount} />
            </dd>
          </div>
        </dl>
      </div>
    );
  else if (spec.kind === "import") body = <ImportBody onDone={done} />;
  else if (spec.kind === "onboarding") body = <OnboardingBody onDone={done} />;
  else if (spec.kind === "command") body = <CommandBody onHide={onHide} />;
  else if (spec.kind === "roles") body = <RolesBody />;
  else if (spec.kind === "lines") body = <DialogLines spec={spec} />;
  else if (spec.kind === "files")
    body = (
      <>
        <FileDrop />
        <FileList />
      </>
    );
  else if (spec.kind === "viewer") body = <PrintBody invoice={item} />;
  else if (spec.kind === "audit")
    body = (
      <>
        <div className="rd-detail-hero">
          <div>
            <span>{t("employeeName")}</span>
            <h3>{t("activity2")}</h3>
          </div>
          <Status value="posted" />
        </div>
        <p className="rd-muted">
          <bdi>2026-11-15 09:42</bdi> · <bdi>{item.id}</bdi>
        </p>
        <table className="rd-native-table rd-audit-table">
          <thead>
            <tr>
              <th>{t("name")}</th>
              <th>{t("before")}</th>
              <th>{t("after")}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th>{t("amount")}</th>
              <td>
                <s>
                  <Amount value={1200000} />
                </s>
              </td>
              <td>
                <Amount value={1265000} />
              </td>
            </tr>
            <tr>
              <th>{t("status")}</th>
              <td>
                <Status value="draft" />
              </td>
              <td>
                <Status value="approved" />
              </td>
            </tr>
          </tbody>
        </table>
        <ActivityTrail />
      </>
    );
  else if (spec.id === "accountTotals")
    body = (
      <>
        <div className="rd-detail-hero">
          <h3>1101 · {t("cash")}</h3>
          <Status value="active" />
        </div>
        <dl className="rd-detail-list">
          {[
            ["openingBalance", 1000000],
            ["debit", 1265000],
            ["creditAmount", 450000],
            ["balanceValue", 1815000],
          ].map(([key, value]) => (
            <div key={key}>
              <dt>{t(String(key))}</dt>
              <dd>
                <Amount value={Number(value)} />
              </dd>
            </div>
          ))}
        </dl>
      </>
    );
  else if (spec.kind === "detail" || spec.kind === "drawer")
    body = <DetailBody spec={spec} invoice={item} />;
  else if (spec.kind === "move")
    body = (
      <>
        <div className="rd-move-account">
          <Icon name="folder" />
          <div>
            <span>{t("currentParent")}</span>
            <strong>1000 · {t("assets")}</strong>
            <small>1101 · {t("cash")}</small>
          </div>
          <Icon name="arrow-down" />
        </div>
        <DemoField field="targetAccount" required />
      </>
    );
  else if (spec.kind === "journal")
    body = (
      <>
        <div className="rd-form-grid">
          <DemoField field="date" />
          <DemoField field="notes" />
        </div>
        <JournalSample />
      </>
    );
  else
    body = (
      <>
        {spec.kind === "danger" ? (
          <div className="rd-danger-heading">
            <span>
              <Icon name={spec.icon} />
            </span>
            <h3>{t("confirmDanger")}</h3>
            <p>{t("dangerNote")}</p>
            <bdi>{item.id}</bdi>
          </div>
        ) : spec.kind === "email" ? (
          <div className="rd-email-attachment">
            <Icon name="file-pdf" />
            <span>Quotation-0148.pdf</span>
            <small>248 KB</small>
          </div>
        ) : (
          <div className="rd-form-banner">
            <span className="rd-icon-tile">
              <Icon name={spec.icon} />
            </span>
            <div>
              <strong>{t(`dialog.${spec.id}`)}</strong>
              <p>{t("demo")}</p>
            </div>
          </div>
        )}
        <div className="rd-form-grid">
          {spec.fields.map((field) => (
            <DemoField
              key={field}
              field={field}
              context={spec.id}
              required={[
                "name",
                "nameAr",
                "email",
                "recipient",
                "password",
                "reason",
                "code",
              ].includes(field)}
            />
          ))}
        </div>
      </>
    );
  return (
    <Dialog
      visible
      header={
        <span className="rd-dialog-title">
          <Icon name={spec.icon} />
          <span>{t(`dialog.${spec.id}`)}</span>
        </span>
      }
      onHide={onHide}
      modal
      blockScroll
      draggable={false}
      resizable={false}
      dismissableMask={false}
      closeOnEscape
      pt={{ closeButton: { "aria-label": t("close") } }}
      rtl={lang === "ar"}
      position={spec.kind === "drawer" ? (lang === "ar" ? "left" : "right") : "center"}
      className={`rd-modal ${large ? "rd-modal-wide" : ""} ${spec.kind === "drawer" ? "rd-drawer" : ""} ${spec.kind === "command" ? "rd-command" : ""}`}
      transitionOptions={{ timeout: motion ? 180 : 0 }}
    >
      <div className="rd-modal-meta">
        <span>
          <i />
          {t("preview")}
        </span>
        <div className="rd-modal-styles" role="group" aria-label={t("directions")}>
          {STYLES.map((value) => (
            <button
              type="button"
              key={value}
              aria-pressed={style === value}
              onClick={() => selectStyle(value)}
            >
              {t(value)}
            </button>
          ))}
        </div>
      </div>
      <form
        id={id}
        onSubmit={(e) => {
          e.preventDefault();
          done();
        }}
      >
        <div className="rd-modal-body">{body}</div>
        {!special || complete ? (
          <div className="rd-modal-actions">
            <B
              label={t(
                complete ||
                  ["success", "detail", "drawer", "viewer", "audit", "files"].includes(spec.kind)
                  ? "close"
                  : "cancel",
              )}
              outlined
              onClick={onHide}
            />
            {!complete && !["success", "drawer", "viewer", "audit", "files"].includes(spec.kind) ? (
              <B
                type="submit"
                label={t(
                  spec.kind === "danger" || spec.id === "post"
                    ? "confirm"
                    : spec.kind === "email"
                      ? "sendPreview"
                      : spec.kind === "detail"
                        ? "done"
                        : "save",
                )}
                severity={spec.kind === "danger" ? "danger" : undefined}
                icon={`pi pi-${spec.kind === "danger" ? "check" : "check"}`}
              />
            ) : null}
          </div>
        ) : null}
      </form>
    </Dialog>
  );
}
