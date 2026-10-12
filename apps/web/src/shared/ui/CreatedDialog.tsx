import { useTranslation } from "react-i18next";
import { Button } from "primereact/button";
import { Dialog } from "primereact/dialog";

export interface CreatedRow {
  readonly label: string;
  readonly value: React.ReactNode;
  // Numbers, codes and ids read left to right even inside an Arabic screen.
  readonly ltr?: boolean;
}

export interface CreatedInfo {
  // What was created, e.g. "Journal entry". Shown under the green tick.
  readonly title: string;
  // The headline value people look for first: the number or code that was just generated.
  readonly headline?: string;
  readonly rows: readonly CreatedRow[];
}

// Shown right after something has been created, so the person can check what was saved (and write down the number)
// instead of finding a new row in a table. Closing it is the only action; the screen behind it is already updated.
export function CreatedDialog({
  info,
  onHide,
  extraAction,
}: {
  readonly info: CreatedInfo | null;
  readonly onHide: () => void;
  // An optional second button, e.g. "Open the document".
  readonly extraAction?: { readonly label: string; readonly onClick: () => void };
}): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <Dialog visible={info !== null} onHide={onHide} className="mk-created" modal dismissableMask header={t("created.title")} closable>
      {info ? (
        <div className="mk-created__body">
          <div className="mk-created__hero">
            <i className="pi pi-check-circle" aria-hidden="true" />
            <div>
              <span>{info.title}</span>
              {info.headline ? <strong dir="ltr">{info.headline}</strong> : null}
            </div>
          </div>
          <dl className="mk-created__rows">
            {info.rows.map((row) => (
              <div key={row.label}>
                <dt>{row.label}</dt>
                <dd dir={row.ltr ? "ltr" : undefined}>{row.value === "" || row.value === null || row.value === undefined ? "—" : row.value}</dd>
              </div>
            ))}
          </dl>
          <div className="mk-created__actions">
            {extraAction ? <Button type="button" label={extraAction.label} outlined onClick={extraAction.onClick} /> : null}
            <Button type="button" label={t("created.ok")} onClick={onHide} autoFocus />
          </div>
        </div>
      ) : null}
    </Dialog>
  );
}
