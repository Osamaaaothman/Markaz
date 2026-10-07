import { useEffect, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { z } from "zod";
import { Button } from "primereact/button";
import { Column } from "primereact/column";
import { DataGrid } from "../../shared/ui/DataGrid";
import { Dialog } from "primereact/dialog";
import { Dropdown } from "primereact/dropdown";
import { InputText } from "primereact/inputtext";
import { InputTextarea } from "primereact/inputtextarea";
import { usePermissions } from "../../shared/auth/use-permissions";
import { formatCalendarDate } from "../../shared/lib/format-date";
import { localizedName } from "../../shared/lib/localized-name";
import { PageSkeleton } from "../../shared/ui/PageSkeleton";
import { PermissionButton } from "../../shared/ui/PermissionButton";
import { useAllItems } from "../inventory/use-items";
import { RequestStatusTag } from "./StatusTags";
import {
  useCreatePurchaseRequest,
  usePurchaseRequest,
  usePurchaseRequests,
  useRejectPurchaseRequest,
  type PurchaseRequestStatus,
  type PurchaseRequestSummary,
} from "./use-purchasing";

const ALL = "ALL";
const STATUSES: readonly PurchaseRequestStatus[] = ["PENDING", "PROCESSED", "REJECTED"];

export function PurchaseRequestsPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const { can } = usePermissions();
  const navigate = useNavigate();
  const [status, setStatus] = useState<PurchaseRequestStatus | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [viewId, setViewId] = useState<string | null>(null);
  const [rejectId, setRejectId] = useState<string | null>(null);

  const { data, isPending, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } = usePurchaseRequests(status);
  const requests = data?.pages.flatMap((page) => page.data) ?? [];

  return (
    <div className="erp-page">
      <div className="erp-page__header">
        <div>
          <h1 className="erp-page__title">{t("purchasing.requests.title")}</h1>
          <p className="erp-page__subtitle">{t("purchasing.requests.subtitle")}</p>
        </div>
        <PermissionButton allowed={can("purchase_request:create")} label={t("purchasing.requests.new")} icon="pi pi-plus" onClick={() => setNewOpen(true)} />
      </div>

      <div className="coa-toolbar">
        <div className="coa-levels">
          <span className="coa-levels__label">{t("purchasing.status")}</span>
          <Dropdown
            value={status ?? ALL}
            onChange={(e) => setStatus(e.value === ALL ? null : (e.value as PurchaseRequestStatus))}
            options={[
              { label: t("purchasing.allStatuses"), value: ALL },
              ...STATUSES.map((s) => ({ label: t(`purchasing.requestStatus.${s}`), value: s })),
            ]}
          />
        </div>
      </div>

      {isPending ? (
        <PageSkeleton />
      ) : isError ? (
        <div className="erp-page">
          <p className="erp-page__error">{t("status.error")}</p>
          <button type="button" className="erp-button-link" onClick={() => void refetch()}>
            {t("actions.retry")}
          </button>
        </div>
      ) : (
        <>
          <DataGrid value={requests} className="erp-table" stripedRows showGridlines size="small" emptyMessage={t("status.empty")}>
            <Column header={t("purchasing.number")} style={{ width: "13rem" }} body={(row: PurchaseRequestSummary) => <span className="coa-code">{row.number}</span>} />
            <Column header={t("purchasing.date")} style={{ width: "8rem" }} body={(row: PurchaseRequestSummary) => formatCalendarDate(row.createdAt, i18n.language)} />
            <Column header={t("purchasing.requests.notes")} body={(row: PurchaseRequestSummary) => row.rejectionReason ?? row.notes ?? ""} />
            <Column header={t("purchasing.lineCount")} style={{ width: "6rem" }} align="right" body={(row: PurchaseRequestSummary) => row.lineCount} />
            <Column header={t("purchasing.status")} style={{ width: "9rem" }} body={(row: PurchaseRequestSummary) => <RequestStatusTag status={row.status} />} />
            <Column
              header=""
              style={{ width: "17rem" }}
              body={(row: PurchaseRequestSummary) => (
                <div className="erp-row-actions">
                  <Button label={t("purchasing.view")} size="small" text onClick={() => setViewId(row.id)} />
                  {row.status === "PENDING" ? (
                    <>
                      <PermissionButton
                        allowed={can("purchase_order:create")}
                        label={t("purchasing.requests.createOrder")}
                        size="small"
                        text
                        onClick={() => void navigate(`/purchasing/orders/new?request=${row.id}`)}
                      />
                      <PermissionButton
                        allowed={can("purchase_request:reject")}
                        label={t("purchasing.requests.reject")}
                        size="small"
                        text
                        severity="danger"
                        onClick={() => setRejectId(row.id)}
                      />
                    </>
                  ) : null}
                  {row.purchaseOrderId ? (
                    <Button label={t("purchasing.requests.openOrder")} size="small" text onClick={() => void navigate(`/purchasing/orders/${row.purchaseOrderId}`)} />
                  ) : null}
                </div>
              )}
            />
          </DataGrid>
          {hasNextPage ? (
            <div className="erp-table-footer erp-table-footer--center">
              <Button label={t("actions.loadMore")} text onClick={() => void fetchNextPage()} loading={isFetchingNextPage} icon="pi pi-chevron-down" />
            </div>
          ) : null}
        </>
      )}

      <NewRequestDialog visible={newOpen} onHide={() => setNewOpen(false)} />
      <RequestDetailDialog id={viewId} onHide={() => setViewId(null)} />
      <RejectDialog id={rejectId} onHide={() => setRejectId(null)} />
    </div>
  );
}

const lineSchema = z.object({
  itemId: z.string().min(1, "required"),
  quantity: z.string().regex(/^\d{1,15}(\.\d{1,4})?$/, "positiveAmount").refine((v) => /[1-9]/.test(v), "positiveAmount"),
});
const requestSchema = z.object({
  notes: z.string(),
  lines: z.array(lineSchema).min(1, "atLeastOneLine"),
});
type RequestFormValues = z.infer<typeof requestSchema>;
const EMPTY_LINE = { itemId: "", quantity: "" };

function NewRequestDialog({ visible, onHide }: { visible: boolean; onHide: () => void }): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const { data: items } = useAllItems();
  const create = useCreatePurchaseRequest();
  const {
    control,
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<RequestFormValues>({ resolver: zodResolver(requestSchema), defaultValues: { notes: "", lines: [EMPTY_LINE] } });
  const { fields, append, remove } = useFieldArray({ control, name: "lines" });

  useEffect(() => {
    if (!visible) return;
    create.reset();
    reset({ notes: "", lines: [EMPTY_LINE] });
    // Reset only when the dialog opens.
  }, [visible]);

  const onSubmit = handleSubmit((values) => {
    create.mutate(
      { ...(values.notes.trim() ? { notes: values.notes.trim() } : {}), lines: values.lines },
      { onSuccess: onHide },
    );
  });

  return (
    <Dialog header={t("purchasing.requests.new")} visible={visible} onHide={onHide} className="erp-dialog" modal style={{ width: "min(46rem, 96vw)" }}>
      <form onSubmit={(e) => void onSubmit(e)} noValidate className="erp-form">
        <div className="erp-field">
          <label htmlFor="prNotes">{t("purchasing.requests.notes")}</label>
          <InputTextarea id="prNotes" rows={2} {...register("notes")} />
        </div>
        <h3 className="erp-form__section-title">{t("purchasing.lines")}</h3>
        <div className="erp-lines">
          {fields.map((field, index) => (
            <div key={field.id} className="erp-lines__row">
              <Controller
                control={control}
                name={`lines.${index}.itemId`}
                render={({ field: f }) => (
                  <Dropdown
                    value={f.value}
                    onChange={(e) => f.onChange(e.value)}
                    options={(items ?? []).map((i) => ({ label: `${i.code} — ${localizedName(i, i18n.language)}`, value: i.id }))}
                    filter
                    placeholder={t("inventory.items.title")}
                    className={errors.lines?.[index]?.itemId ? "p-invalid erp-lines__account" : "erp-lines__account"}
                  />
                )}
              />
              <InputText placeholder={t("purchasing.quantity")} dir="ltr" {...register(`lines.${index}.quantity`)} className={`erp-lines__amount${errors.lines?.[index]?.quantity ? " p-invalid" : ""}`} />
              <Button type="button" icon="pi pi-trash" text severity="danger" aria-label={t("actions.removeLine")} onClick={() => remove(index)} disabled={fields.length <= 1} />
            </div>
          ))}
        </div>
        <Button type="button" data-erp-add-line label={t("actions.addLine")} icon="pi pi-plus" text onClick={() => append(EMPTY_LINE)} />
        {errors.lines?.root?.message ? <p className="erp-field__error">{t(`validation.${errors.lines.root.message}`)}</p> : null}
        {create.isError ? <p className="erp-auth-card__error">{t("purchasing.requests.createError")}</p> : null}
        <div className="erp-form__actions">
          <Button type="button" label={t("actions.cancel")} text onClick={onHide} />
          <Button type="submit" label={t("actions.save")} loading={create.isPending} />
        </div>
      </form>
    </Dialog>
  );
}

function RequestDetailDialog({ id, onHide }: { id: string | null; onHide: () => void }): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const { data, isPending } = usePurchaseRequest(id);
  return (
    <Dialog header={data?.number ?? t("purchasing.requests.title")} visible={id !== null} onHide={onHide} className="erp-dialog" modal style={{ width: "min(40rem, 96vw)" }}>
      {isPending || !data ? (
        <PageSkeleton />
      ) : (
        <>
          {data.notes ? <p>{data.notes}</p> : null}
          {data.rejectionReason ? <p className="erp-page__error">{data.rejectionReason}</p> : null}
          <DataGrid value={[...data.lines]} className="erp-table" stripedRows showGridlines size="small">
            <Column header={t("inventory.items.code")} body={(l: (typeof data.lines)[number]) => <span className="coa-code">{l.itemCode}</span>} />
            <Column header={t("inventory.items.name")} body={(l: (typeof data.lines)[number]) => localizedName({ name: l.itemName, nameAr: l.itemNameAr }, i18n.language)} />
            <Column header={t("purchasing.quantity")} align="right" body={(l: (typeof data.lines)[number]) => `${l.quantity} ${l.unit}`} />
          </DataGrid>
        </>
      )}
    </Dialog>
  );
}

function RejectDialog({ id, onHide }: { id: string | null; onHide: () => void }): React.JSX.Element {
  const { t } = useTranslation();
  const [reason, setReason] = useState("");
  const reject = useRejectPurchaseRequest();

  useEffect(() => {
    if (id !== null) {
      setReason("");
      reject.reset();
    }
    // Reset when opened for a request.
  }, [id]);

  return (
    <Dialog header={t("purchasing.requests.reject")} visible={id !== null} onHide={onHide} className="erp-dialog" modal style={{ width: "min(30rem, 96vw)" }}>
      <div className="erp-form">
        <div className="erp-field">
          <label htmlFor="rejectReason">{t("purchasing.requests.rejectReason")}</label>
          <InputTextarea id="rejectReason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        {reject.isError ? <p className="erp-auth-card__error">{t("purchasing.requests.rejectError")}</p> : null}
        <div className="erp-form__actions">
          <Button type="button" label={t("actions.cancel")} text onClick={onHide} />
          <Button
            type="button"
            label={t("purchasing.requests.reject")}
            severity="danger"
            disabled={reason.trim() === ""}
            loading={reject.isPending}
            onClick={() => id && reject.mutate({ id, reason: reason.trim() }, { onSuccess: onHide })}
          />
        </div>
      </div>
    </Dialog>
  );
}
