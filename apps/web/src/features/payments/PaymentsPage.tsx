import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Button } from "primereact/button";
import { Column } from "primereact/column";
import { DataGrid } from "../../shared/ui/DataGrid";
import { Dropdown } from "primereact/dropdown";
import { Tag } from "primereact/tag";
import { Money } from "@erp/shared";
import { usePermissions } from "../../shared/auth/use-permissions";
import { formatCalendarDate } from "../../shared/lib/format-date";
import { localizedName } from "../../shared/lib/localized-name";
import { formatMoney } from "../../shared/lib/money";
import { PageSkeleton } from "../../shared/ui/PageSkeleton";
import { PermissionButton } from "../../shared/ui/PermissionButton";
import { usePayments, type PaymentDirection, type PaymentSummary } from "./use-payments";

const ALL = "ALL";

export function PaymentsPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const { can } = usePermissions();
  const navigate = useNavigate();
  const [direction, setDirection] = useState<PaymentDirection | null>(null);
  const { data, isPending, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } = usePayments(direction);
  const rows = data?.pages.flatMap((p) => p.data) ?? [];

  return (
    <div className="erp-page erp-page--wide">
      <div className="erp-page__header">
        <div>
          <h1 className="erp-page__title">{t("payments.title")}</h1>
          <p className="erp-page__subtitle">{t("payments.subtitle")}</p>
        </div>
        <div className="erp-page__header-actions">
          <PermissionButton allowed={can("customer_receipt:create")} label={t("payments.newReceipt")} icon="pi pi-arrow-down-left" onClick={() => void navigate("/payments/receipts/new")} />
          <PermissionButton allowed={can("supplier_payment:create")} label={t("payments.newPayment")} icon="pi pi-arrow-up-right" outlined onClick={() => void navigate("/payments/supplier/new")} />
        </div>
      </div>

      <div className="coa-toolbar">
        <div className="coa-levels">
          <span className="coa-levels__label">{t("payments.direction")}</span>
          <Dropdown
            value={direction ?? ALL}
            onChange={(e) => setDirection(e.value === ALL ? null : (e.value as PaymentDirection))}
            options={[
              { label: t("payments.allDirections"), value: ALL },
              { label: t("payments.directions.RECEIPT"), value: "RECEIPT" },
              { label: t("payments.directions.PAYMENT"), value: "PAYMENT" },
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
          <DataGrid value={rows} className="erp-table" stripedRows showGridlines size="small" emptyMessage={t("status.empty")}>
            <Column header={t("purchasing.number")} style={{ width: "13rem" }} body={(r: PaymentSummary) => <span className="coa-code">{r.number}</span>} />
            <Column header={t("payments.direction")} style={{ width: "10rem" }} body={(r: PaymentSummary) => <Tag value={t(`payments.directions.${r.direction}`)} severity={r.direction === "RECEIPT" ? "success" : "info"} />} />
            <Column header={t("payments.party")} body={(r: PaymentSummary) => localizedName({ name: r.partyName, nameAr: r.partyNameAr }, i18n.language)} />
            <Column header={t("payments.date")} style={{ width: "9rem" }} body={(r: PaymentSummary) => formatCalendarDate(r.paymentDate, i18n.language)} />
            <Column header={t("payments.method")} style={{ width: "10rem" }} body={(r: PaymentSummary) => t(`payments.methods.${r.method}`)} />
            <Column header={t("payments.reference")} body={(r: PaymentSummary) => r.reference ?? ""} />
            <Column header={t("payments.amount")} align="right" body={(r: PaymentSummary) => <strong>{formatMoney(r.amount, r.currency)}</strong>} />
            <Column header={t("payments.onAccount")} align="right" body={(r: PaymentSummary) => formatMoney(Money.of(r.amount, r.currency).subtract(Money.of(r.allocated, r.currency)).toDecimalString(4), r.currency)} />
          </DataGrid>
          {hasNextPage ? (
            <div className="erp-table-footer erp-table-footer--center">
              <Button label={t("actions.loadMore")} text onClick={() => void fetchNextPage()} loading={isFetchingNextPage} icon="pi pi-chevron-down" />
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
