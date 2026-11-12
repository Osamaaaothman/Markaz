import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "primereact/button";
import { Dialog } from "primereact/dialog";
import { Checkbox } from "primereact/checkbox";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Tag } from "primereact/tag";
import { apiClient } from "../../api/client";
import { downloadBlob } from "../../lib/download-file";

interface Row {
  rowNumber: number;
  values: Record<string, string>;
  errors: { field: string; code: string }[];
}
function parseFile(file: File): Promise<Omit<Row, "errors">[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./import-file.worker.ts", import.meta.url), {
      type: "module",
    });
    const timer = window.setTimeout(() => {
      worker.terminate();
      reject(new Error("FILE_LIMIT"));
    }, 15000);
    worker.onmessage = (event: MessageEvent<{ rows?: Omit<Row, "errors">[]; error?: string }>) => {
      window.clearTimeout(timer);
      worker.terminate();
      if (event.data.rows) resolve(event.data.rows);
      else reject(new Error(event.data.error));
    };
    worker.onerror = () => {
      window.clearTimeout(timer);
      worker.terminate();
      reject(new Error("INVALID_FILE"));
    };
    worker.postMessage(file);
  });
}
export default function ImportDialog({
  kind,
  onHide,
}: {
  kind: "items" | "parties";
  onHide: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [skipInvalid, setSkipInvalid] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const fields =
    kind === "items"
      ? ["code", "name", "nameAr", "unit", "reorderPoint"]
      : [
          "name",
          "nameAr",
          "kind",
          "phone",
          "email",
          "vatNumber",
          "commercialRegistration",
          "streetName",
          "city",
          "postalCode",
          "countryCode",
        ];
  const valid = rows.filter((row) => !row.errors.length);
  const upload = async (file: File) => {
    setBusy(true);
    setError("");
    setDone(null);
    setRows([]);
    setSkipInvalid(false);
    try {
      const parsed = await parseFile(file);
      setRows((await apiClient.post<Row[]>(`/v1/${kind}/import/preview`, { rows: parsed })).data);
    } catch (e) {
      setError(
        e instanceof Error &&
          ["FILE_LIMIT", "INVALID_HEADERS", "ROW_LIMIT", "INVALID_FILE"].includes(e.message)
          ? e.message
          : "REQUEST_FAILED",
      );
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    setBusy(true);
    setError("");
    const selected = (skipInvalid ? valid : rows).map(({ rowNumber, values }) => ({
      rowNumber,
      values,
    }));
    try {
      const result = await apiClient.post<{ imported: number }>(`/v1/${kind}/import/commit`, {
        rows: selected,
      });
      setDone(result.data.imported);
      setRows([]);
      await qc.invalidateQueries({ queryKey: [kind] });
    } catch {
      setError("COMMIT_FAILED");
      try {
        setRows(
          (
            await apiClient.post<Row[]>(`/v1/${kind}/import/preview`, {
              rows: rows.map(({ rowNumber, values }) => ({ rowNumber, values })),
            })
          ).data,
        );
      } catch {
        /* Retain the previous preview and explicit failure. */
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      visible
      header={t("imports.title", { kind: t(`imports.${kind}`) })}
      onHide={() => {
        if (!busy) onHide();
      }}
      closable={!busy}
      closeOnEscape={!busy}
      className="erp-dialog"
      modal
    >
      <p>{t("imports.hint")}</p>
      <p className="erp-field__hint">{t("imports.kindsHint")}</p>
      <div className="erp-page__header-actions">
        <Button
          type="button"
          label={t("imports.template")}
          outlined
          onClick={() =>
            downloadBlob(
              new Blob(["\uFEFF" + fields.join(",") + "\r\n"], { type: "text/csv;charset=utf-8" }),
              `${kind}-template.csv`,
            )
          }
        />
        <Button
          type="button"
          label={t("imports.choose")}
          loading={busy}
          onClick={() => input.current?.click()}
        />
        <input
          ref={input}
          type="file"
          accept=".csv,.xlsx"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void upload(file);
          }}
        />
      </div>
      {error ? (
        <p role="alert" className="erp-page__error">
          {t(`imports.errors.${error}`)}
        </p>
      ) : null}
      {done !== null ? <p role="status">{t("imports.success", { count: done })}</p> : null}
      {rows.length ? (
        <>
          <p>
            {t("imports.summary", { valid: valid.length, invalid: rows.length - valid.length })}
          </p>
          <DataTable value={rows} paginator rows={10} scrollable size="small" dataKey="rowNumber">
            <Column field="rowNumber" header={t("imports.row")} />
            {fields
              .filter((field) => rows.some((row) => row.values[field]))
              .map((field) => (
                <Column
                  key={field}
                  header={t(`imports.fields.${field}`)}
                  body={(row: Row) => row.values[field] ?? ""}
                />
              ))}
            <Column
              header={t("imports.issues")}
              style={{ minWidth: "15rem" }}
              body={(row: Row) =>
                row.errors.length ? (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "flex-start",
                      gap: "0.375rem",
                    }}
                  >
                    {row.errors.map((issue, index) => (
                      <Tag
                        key={index}
                        severity={issue.code.startsWith("DUPLICATE_") ? "warning" : "danger"}
                        icon={
                          issue.code.startsWith("DUPLICATE_")
                            ? "pi pi-copy"
                            : "pi pi-exclamation-circle"
                        }
                        value={`${t(`imports.fields.${issue.field}`, issue.field)}: ${t(`imports.errors.${issue.code}`)}`}
                      />
                    ))}
                  </div>
                ) : (
                  <Tag severity="success" icon="pi pi-check" value={t("imports.valid")} />
                )
              }
            />
          </DataTable>
          {valid.length !== rows.length ? (
            <label
              style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBlock: "1rem" }}
            >
              <Checkbox
                checked={skipInvalid}
                disabled={busy}
                onChange={(e) => setSkipInvalid(Boolean(e.checked))}
              />{" "}
              <span>{t("imports.skipInvalid")}</span>
            </label>
          ) : null}
          <div className="erp-form__actions">
            <Button
              type="button"
              label={t("imports.save", { count: skipInvalid ? valid.length : rows.length })}
              loading={busy}
              disabled={!valid.length || (!skipInvalid && valid.length !== rows.length)}
              onClick={() => void save()}
            />
          </div>
        </>
      ) : null}
    </Dialog>
  );
}
