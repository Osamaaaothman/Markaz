import { useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { Accordion, AccordionTab } from "primereact/accordion";
import { TabView, TabPanel } from "primereact/tabview";
import { Steps } from "primereact/steps";
import { BreadCrumb } from "primereact/breadcrumb";
import { Skeleton } from "primereact/skeleton";
import { Message } from "primereact/message";
import { Avatar } from "primereact/avatar";
import { Image } from "primereact/image";
import { Checkbox } from "primereact/checkbox";
import { Amount, B, DemoField, Icon, Panel, Section, usePreview } from "./ui";

export function AuthPatterns(): React.JSX.Element {
  const { t, notify, open } = usePreview();
  const [remember, setRemember] = useState(false);
  return (
    <div className="rd-auth-pattern">
      <div className="rd-auth-story">
        <span className="rd-overline">{t("authPattern")}</span>
        <span className="rd-brand-mark">
          <i />
          <b />
        </span>
        <h3>{t("loginTitle")}</h3>
        <p>{t("loginHint")}</p>
        <div className="rd-account-card">
          <Avatar label={t("employeeName").slice(0, 1)} shape="circle" />
          <div>
            <strong>{t("employeeName")}</strong>
            <small>{t("accountant")}</small>
          </div>
          <B icon="pi pi-cog" text aria-label={t("settings")} onClick={() => open("user")} />
        </div>
      </div>
      <form
        className="rd-auth-form"
        onSubmit={(e) => {
          e.preventDefault();
          notify(t("loginSample"));
        }}
      >
        <div>
          <h3>{t("login")}</h3>
          <p>{t("localOnly")}</p>
        </div>
        <DemoField field="email" required />
        <DemoField field="password" required />
        <label className="rd-auth-remember" htmlFor="preview-remember">
          <Checkbox
            inputId="preview-remember"
            checked={remember}
            onChange={(e) => setRemember(Boolean(e.checked))}
          />
          {t("remember")}
        </label>
        <B type="submit" label={t("login")} icon="pi pi-arrow-up-left" />
      </form>
    </div>
  );
}

export function ActivityTrail(): React.JSX.Element {
  const { t, open } = usePreview();
  return (
    <ol className="rd-timeline">
      {[1, 2, 3].map((n) => (
        <li key={n}>
          <span className="rd-timeline-dot">
            <Icon name={n === 1 ? "plus" : n === 2 ? "pencil" : "check"} />
          </span>
          <div>
            <button type="button" onClick={() => open("audit")}>
              {t(`activity${n}`)}
            </button>
            <p>
              {t("employeeName")} <span>·</span> {t(`ago${n}`)}
            </p>
            {n === 2 ? (
              <span className="rd-audit-mini">
                <s dir="ltr">12,000.00</s>
                <Icon name="arrow-left" />
                <bdi>12,650.00</bdi>
              </span>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
export function NavigationSection(): React.JSX.Element {
  const { t, open } = usePreview();
  const [step, setStep] = useState(0);
  return (
    <Section id="navigation">
      <div className="rd-two-col">
        <Panel>
          <BreadCrumb
            home={{
              icon: "pi pi-home",
              command: () => document.getElementById("overview")?.scrollIntoView(),
            }}
            model={[
              {
                label: t("sales"),
                command: () => document.getElementById("tables")?.scrollIntoView(),
              },
              { label: t("invoice") },
            ]}
          />
          <TabView>
            <TabPanel header={t("details")}>
              <dl className="rd-detail-list">
                <div>
                  <dt>{t("customer")}</dt>
                  <dd>{t("client1")}</dd>
                </div>
                <div>
                  <dt>{t("number")}</dt>
                  <dd>
                    <bdi>INV-2026-0148</bdi>
                  </dd>
                </div>
                <div>
                  <dt>{t("total")}</dt>
                  <dd>
                    <Amount value={1265000} />
                  </dd>
                </div>
              </dl>
            </TabPanel>
            <TabPanel header={t("activity")}>
              <ActivityTrail />
            </TabPanel>
            <TabPanel header={`${t("attachments")} (2)`}>
              <FileList />
            </TabPanel>
          </TabView>
          <div className="rd-wrap">
            <Avatar label={t("employeeName").slice(0, 1)} shape="circle" />
            <span>{t("employeeName")}</span>
            <span className="rd-muted">{t("accountant")}</span>
            <B label={t("jump")} text icon="pi pi-search" onClick={() => open("command")} />
            <kbd>Ctrl K</kbd>
          </div>
        </Panel>
        <Panel>
          <Steps
            model={["stepDetails", "stepReview", "stepDone"].map((label) => ({ label: t(label) }))}
            activeIndex={step}
            onSelect={(e) => setStep(e.index)}
            readOnly={false}
          />
          <div className="rd-step-content">
            <span className="rd-step-number">0{step + 1}</span>
            <h3>{t(["stepDetails", "stepReview", "stepDone"][step]!)}</h3>
            <p>{t(step === 2 ? "successHint" : "postNote")}</p>
          </div>
          <div className="rd-between">
            <B
              label={t("previous")}
              text
              disabled={step === 0}
              onClick={() => setStep((s) => s - 1)}
            />
            <B
              label={t(step === 2 ? "done" : "next")}
              outlined
              onClick={() => setStep((s) => (s === 2 ? 0 : s + 1))}
            />
          </div>
          <Accordion>
            <AccordionTab header={t("faq1")}>
              <p>{t("faq1Body")}</p>
            </AccordionTab>
            <AccordionTab header={t("faq2")}>
              <p>{t("faq2Body")}</p>
            </AccordionTab>
          </Accordion>
        </Panel>
      </div>
      <AuthPatterns />
    </Section>
  );
}
export function FeedbackSection(): React.JSX.Element {
  const { t, notify, open } = usePreview();
  const [retrying, setRetrying] = useState(false);
  return (
    <Section id="feedback">
      <div className="rd-feedback-grid">
        {(
          [
            ["success", "success", "check-circle"],
            ["warning", "warn", "exclamation-triangle"],
            ["error", "error", "times-circle"],
            ["info", "info", "info-circle"],
          ] as const
        ).map(([key, severity, icon]) => (
          <div className={`rd-notice rd-notice-${severity}`} key={key}>
            <Icon name={icon} />
            <div>
              <strong>{t(key)}</strong>
              <p>{t(`${key}Hint`)}</p>
              <button type="button" onClick={() => notify(t(key), severity)}>
                {t("toast")} <Icon name="arrow-up-left" />
              </button>
            </div>
          </div>
        ))}
      </div>
      <div className="rd-three-col">
        <Panel className="rd-empty">
          <div className="rd-empty-art">
            <Icon name="inbox" />
          </div>
          <h3>{t("empty")}</h3>
          <p>{t("emptyHint")}</p>
          <B
            label={t("newInvoice")}
            icon="pi pi-plus"
            outlined
            onClick={() => document.getElementById("documents")?.scrollIntoView()}
          />
        </Panel>
        <Panel className="rd-skeleton-panel">
          <span className="rd-label">{t("loadingData")}</span>
          <div className="rd-skeleton-head">
            <Skeleton shape="circle" size="2.5rem" animation="none" />
            <div>
              <Skeleton width="8rem" height="0.75rem" animation="none" />
              <Skeleton width="5rem" height="0.55rem" animation="none" />
            </div>
          </div>
          {[1, 2, 3].map((i) => (
            <div className="rd-skeleton-line" key={i}>
              <Skeleton width="42%" height="0.65rem" animation="none" />
              <Skeleton width="25%" height="0.65rem" animation="none" />
            </div>
          ))}
          <div className="rd-upload-progress">
            <div className="rd-between">
              <span>{t("uploadProgress")}</span>
              <bdi>64%</bdi>
            </div>
            <progress max={100} value={64} aria-label={t("uploadProgress")} />
          </div>
        </Panel>
        <Panel className="rd-empty">
          <div className="rd-empty-art">
            <Icon name="wifi" />
          </div>
          <h3>{t("offline")}</h3>
          <p>{t("offlineHint")}</p>
          <B
            label={t(retrying ? "loadingData" : "retry")}
            icon="pi pi-refresh"
            outlined
            loading={retrying}
            onClick={() => {
              setRetrying(true);
              window.setTimeout(() => {
                setRetrying(false);
                notify(t("success"));
              }, 700);
            }}
          />
        </Panel>
      </div>
      <div className="rd-permission-bar">
        <Message severity="info" text={`${t("permission")} · ${t("permissionHint")}`} />
        <B label={t("post")} disabled icon="pi pi-lock" />
        <B label={t("roles")} text onClick={() => open("roles")} />
      </div>
    </Section>
  );
}
interface LocalFile {
  id: number;
  name: string;
  size: number;
}
export function FileList(): React.JSX.Element {
  const { t, open } = usePreview();
  return (
    <div className="rd-file-list">
      {["quotation-0148.pdf", "delivery-note.pdf"].map((name, index) => (
        <button type="button" className="rd-file-row" key={name} onClick={() => open("viewer")}>
          <span className="rd-file-icon">
            <Icon name="file-pdf" />
          </span>
          <span>
            <strong dir="ltr">{name}</strong>
            <small>{index ? "128 KB" : "248 KB"} · PDF</small>
          </span>
          <Icon name="eye" />
          <span className="rd-sr-only">{t("openDetails")}</span>
        </button>
      ))}
    </div>
  );
}
export function FileDrop(): React.JSX.Element {
  const { t, notify } = usePreview();
  const input = useRef<HTMLInputElement>(null);
  const serial = useRef(0);
  const [files, setFiles] = useState<LocalFile[]>([]);
  const [drag, setDrag] = useState(false);
  function addFiles(selected: FileList | null): void {
    if (!selected) return;
    const accepted = [...selected].filter((file) => {
      if (file.size > 10 * 1024 * 1024) {
        notify(t("fileTooLarge"), "warn");
        return false;
      }
      return true;
    });
    setFiles((prev) => [
      ...prev,
      ...accepted.map((file) => ({ id: ++serial.current, name: file.name, size: file.size })),
    ]);
    if (accepted.length) notify(t("fileSelected"), "info");
  }
  return (
    <>
      <div
        className={`rd-dropzone ${drag ? "is-dragging" : ""}`}
        onDragOver={(e: DragEvent) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e: DragEvent) => {
          e.preventDefault();
          setDrag(false);
          addFiles(e.dataTransfer.files);
        }}
      >
        <Icon name="cloud-upload" />
        <strong>{t("dropFiles")}</strong>
        <p>{t("fileHint")}</p>
        <B label={t("browse")} outlined onClick={() => input.current?.click()} />
        <input
          ref={input}
          type="file"
          multiple
          hidden
          accept=".pdf,.png,.jpg,.jpeg,.webp,.csv,.xlsx"
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
      {files.length ? (
        <ul className="rd-local-files">
          {files.map((file) => (
            <li key={file.id}>
              <Icon name="file" />
              <span dir="auto">{file.name}</span>
              <small>{Math.max(1, Math.ceil(file.size / 1024))} KB</small>
              <B
                icon="pi pi-times"
                text
                aria-label={`${t("delete")} ${file.name}`}
                onClick={() => setFiles((items) => items.filter((item) => item.id !== file.id))}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
export function FilesSection(): React.JSX.Element {
  const { t } = usePreview();
  return (
    <Section id="files">
      <div className="rd-two-col">
        <Panel title={t("attachments")}>
          <FileDrop />
          <FileList />
          <div className="rd-image-sample">
            <Image src="/favicon.svg" alt={t("brand")} width="42" preview />
            <span>{t("brand")} · SVG</span>
          </div>
        </Panel>
        <Panel title={t("activity")}>
          <ActivityTrail />
          <div className="rd-document-trail">
            {["dialog.quotation", "dialog.convert", "invoice", "dialog.hrPayment"].map(
              (label, index) => (
                <span key={label}>
                  <i>{index + 1}</i>
                  {t(label)}
                </span>
              ),
            )}
          </div>
        </Panel>
      </div>
    </Section>
  );
}
export function FoundationsSection(): React.JSX.Element {
  const { t, style, motion } = usePreview();
  const [replay, setReplay] = useState(0);
  return (
    <Section id="foundations">
      <div className="rd-two-col">
        <Panel title={t("typography")}>
          <div className="rd-type-sample">
            <small>IBM PLEX SANS ARABIC</small>
            <strong>{t("typeSample")}</strong>
            <p>{t("bodySample")}</p>
            <bdi>0123456789 · 12,650.00</bdi>
            <small>{t("tabular")}</small>
          </div>
        </Panel>
        <Panel title={t("palette")}>
          <div className="rd-swatches">
            {["primary", "success", "warning", "danger"].map((key) => (
              <div key={key}>
                <span className={`rd-swatch rd-swatch-${key}`} />
                <small>{t(key)}</small>
              </div>
            ))}
          </div>
          <div className="rd-shapes">
            <span className="rd-shape" />
            <div>
              <strong>{t("shape")}</strong>
              <p>{t(`${style}Shape`)}</p>
            </div>
          </div>
        </Panel>
      </div>
      <Panel title={t("motion")} className="rd-motion-panel">
        <p>{t("motionNote")}</p>
        <div className="rd-motion-demo">
          <div className={motion ? "rd-motion-card" : "rd-motion-card is-static"} key={replay}>
            <span className="rd-icon-tile">
              <Icon name="check" />
            </span>
            <strong>{t("motionSample")}</strong>
          </div>
          <B
            label={t("replay")}
            outlined
            icon="pi pi-replay"
            onClick={() => setReplay((n) => n + 1)}
          />
        </div>
      </Panel>
    </Section>
  );
}
