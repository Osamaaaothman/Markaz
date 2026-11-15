import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Avatar } from "primereact/avatar";
import { Button } from "primereact/button";
import { Column } from "primereact/column";
import { Image } from "primereact/image";
import { InputNumber } from "primereact/inputnumber";
import { InputText } from "primereact/inputtext";
import { InputTextarea } from "primereact/inputtextarea";
import { Message } from "primereact/message";
import { MultiSelect } from "primereact/multiselect";
import { OverlayPanel } from "primereact/overlaypanel";
import { Password } from "primereact/password";
import { TabPanel, TabView } from "primereact/tabview";
import { Toast } from "primereact/toast";
import { Tooltip } from "primereact/tooltip";
import { TreeTable, type TreeTableExpandedKeysType } from "primereact/treetable";
import { DataGrid } from "../../shared/ui/DataGrid";
import { ChoiceSelect } from "../../shared/ui/ChoiceSelect";
import { CopyId } from "../../shared/ui/CopyId";
import { CreatedDialog } from "../../shared/ui/CreatedDialog";
import { EmptyState } from "../../shared/ui/EmptyState";
import { LineField } from "../../shared/ui/LineField";
import { PermissionButton } from "../../shared/ui/PermissionButton";
import { UploadProgress } from "../attachments/UploadProgress";

/** Real production controls with local sample values. No business hook or mutation
 * belongs here: the same reference runs both in the app and the isolated harness. */
export function ComponentGallery(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const [quantity, setQuantity] = useState<number | null>(4);
  const [password, setPassword] = useState("");
  const [selected, setSelected] = useState<string[]>(["a"]);
  const [choice, setChoice] = useState("a");
  const [created, setCreated] = useState(false);
  const [expanded, setExpanded] = useState<TreeTableExpandedKeysType>({ assets: true });
  const overlay = useRef<OverlayPanel>(null);
  const toast = useRef<Toast>(null);
  const choices = [
    { label: t("ds.primary"), value: "a" },
    { label: t("ds.secondary"), value: "b" },
  ];
  const records = Array.from({ length: 12 }, (_, index) => ({
    id: `SAMPLE-${index + 1}`,
    number: `INV-${String(index + 1).padStart(4, "0")}`,
    name: t("ds.sample"),
    quantity: index + 1,
  }));
  const tree = [
    {
      key: "assets",
      data: { name: t("ds.gallery.accounts"), code: "1000" },
      children: [{ key: "cash", data: { name: t("dashboard.kpi.cash"), code: "1100" } }],
    },
  ];

  return (
    <section className="erp-card mk-component-gallery" aria-labelledby="component-gallery-title">
      <h2 className="erp-card__title" id="component-gallery-title">
        {t("ds.gallery.title")}
      </h2>
      <p className="erp-field__hint">{t("ds.gallery.note")}</p>
      <h3 className="erp-form__section-title">{t("ds.gallery.actions")}</h3>
      <div className="mk-ds__row" data-testid="gallery-actions">
        {(["success", "warning", "info", "danger", "secondary"] as const).map((severity) => (
          <Button
            key={severity}
            icon="pi pi-check"
            rounded
            text
            severity={severity}
            aria-label={t(`ds.gallery.${severity}`)}
          />
        ))}
        <Button label={t("ds.primary")} rounded />
        <Button label={t("ds.small")} size="small" outlined />
        <Button label={t("ds.gallery.large")} size="large" />
        <PermissionButton allowed={false} label={t("ds.disabled")} icon="pi pi-lock" />
        <CopyId value="SAMPLE-001" />
        <button type="button" className="erp-button-link" onClick={() => setCreated(true)}>
          {t("ds.openDialog")}
        </button>
      </div>
      <h3 className="erp-form__section-title">{t("ds.gallery.fields")}</h3>
      <div className="erp-form__row">
        <LineField label={t("ds.gallery.quantity")}>
          <InputNumber
            value={quantity}
            onValueChange={(event) => setQuantity(event.value ?? null)}
            showButtons
            min={0}
          />
        </LineField>
        <div className="erp-field">
          <label htmlFor="gallery-password">{t("ds.gallery.password")}</label>
          <Password
            inputId="gallery-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            toggleMask
            feedback={false}
          />
        </div>
        <div className="erp-field">
          <label htmlFor="gallery-multi">{t("ds.gallery.multiselect")}</label>
          <MultiSelect
            inputId="gallery-multi"
            value={selected}
            options={choices}
            onChange={(event) => setSelected(event.value as string[])}
            display="chip"
            filter
          />
        </div>
        <div className="erp-field">
          <label htmlFor="gallery-notes">{t("ds.gallery.notes")}</label>
          <InputTextarea id="gallery-notes" rows={2} autoResize />
        </div>
        <div className="erp-field">
          <label htmlFor="gallery-readonly">{t("ds.gallery.readonly")}</label>
          <InputText id="gallery-readonly" value="SAMPLE-001" readOnly />
        </div>
        <LineField label={t("ds.dropdownField")}>
          <ChoiceSelect
            label={t("ds.gallery.choice")}
            value={choice}
            onChange={setChoice}
            options={choices}
          />
        </LineField>
      </div>
      <h3 className="erp-form__section-title">{t("ds.gallery.grid")}</h3>
      <div data-testid="gallery-grid">
        <DataGrid value={records} pageSize={10} size="small" stripedRows showGridlines>
          <Column field="number" header={t("ds.number")} filter sortable />
          <Column field="name" header={t("ds.customer")} sortable />
          <Column field="quantity" header={t("ds.gallery.quantity")} align="right" sortable />
        </DataGrid>
      </div>
      <h3 className="erp-form__section-title">{t("ds.gallery.tree")}</h3>
      <TreeTable
        value={tree}
        className="erp-table"
        expandedKeys={expanded}
        onToggle={(event) => setExpanded(event.value)}
        data-testid="gallery-tree"
      >
        <Column field="name" header={t("ds.gallery.accounts")} expander />
        <Column field="code" header={t("ds.number")} />
      </TreeTable>
      <h3 className="erp-form__section-title">{t("ds.gallery.overlays")}</h3>
      <div className="mk-ds__row">
        <Button
          label={t("ds.gallery.popover")}
          outlined
          onClick={(event) => overlay.current?.toggle(event)}
        />
        <OverlayPanel ref={overlay} showCloseIcon>
          <p>{t("ds.dialogBody")}</p>
          <ChoiceSelect
            label={t("ds.gallery.choice")}
            value={choice}
            onChange={setChoice}
            options={choices}
          />
        </OverlayPanel>
        <Button label={t("ds.gallery.created")} outlined onClick={() => setCreated(true)} />
        <Button
          label={t("ds.gallery.toast")}
          onClick={() =>
            toast.current?.show({
              severity: "success",
              summary: t("feedback.success"),
              detail: t("ds.gallery.localOnly"),
              life: 5000,
            })
          }
        />
        <Button className="mk-gallery-tooltip" label={t("ds.gallery.tooltip")} outlined />
        <Tooltip target=".mk-gallery-tooltip" content={t("ds.gallery.localOnly")} event="both" />
        <Avatar icon="pi pi-user" aria-label={t("ds.gallery.avatar")} />
        <Avatar icon="pi pi-user" shape="circle" aria-label={t("ds.gallery.avatar")} />
      </div>
      <Toast ref={toast} position={i18n.language.startsWith("ar") ? "top-left" : "top-right"} />
      <CreatedDialog
        info={
          created
            ? {
                title: t("ds.gallery.localOnly"),
                headline: "SAMPLE-001",
                rows: [{ label: t("ds.number"), value: "SAMPLE-001", ltr: true }],
              }
            : null
        }
        onHide={() => setCreated(false)}
      />
      <TabView>
        <TabPanel header={t("ds.gallery.feedback")}>
          <div className="mk-gallery-feedback">
            {(["success", "info", "warn", "error"] as const).map((severity) => (
              <Message
                key={severity}
                severity={severity}
                text={t(severity === "info" ? "ds.gallery.localOnly" : `feedback.${severity}`)}
              />
            ))}
          </div>
        </TabPanel>
        <TabPanel header={t("ds.gallery.empty")}>
          <EmptyState
            title={t("ds.empty")}
            hint={t("ds.emptyBody")}
            action={{ label: t("ds.openDialog"), onClick: () => setCreated(true) }}
          />
        </TabPanel>
        <TabPanel header={t("ds.gallery.files")}>
          <UploadProgress name="sample.pdf" percent={64} />
          <Image src="/favicon.svg" alt={t("app.name")} width="80" preview />
        </TabPanel>
      </TabView>
    </section>
  );
}
