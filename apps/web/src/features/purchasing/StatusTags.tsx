import { useTranslation } from "react-i18next";
import { Tag } from "primereact/tag";
import type { PurchaseOrderStatus, PurchaseRequestStatus } from "./use-purchasing";

type Severity = "success" | "info" | "warning" | "danger" | "secondary";

const REQUEST_SEVERITY: Record<PurchaseRequestStatus, Severity> = {
  PENDING: "warning",
  PROCESSED: "success",
  REJECTED: "danger",
};

const ORDER_SEVERITY: Record<PurchaseOrderStatus, Severity> = {
  PENDING_APPROVAL: "warning",
  APPROVED: "info",
  REJECTED: "danger",
  PARTIALLY_RECEIVED: "info",
  RECEIVED: "success",
  CANCELLED: "secondary",
};

export function RequestStatusTag({ status }: { status: PurchaseRequestStatus }): React.JSX.Element {
  const { t } = useTranslation();
  return <Tag value={t(`purchasing.requestStatus.${status}`)} severity={REQUEST_SEVERITY[status]} />;
}

export function OrderStatusTag({ status }: { status: PurchaseOrderStatus }): React.JSX.Element {
  const { t } = useTranslation();
  return <Tag value={t(`purchasing.orderStatus.${status}`)} severity={ORDER_SEVERITY[status]} />;
}
