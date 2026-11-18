import { useTranslation } from "react-i18next";
import { Tag } from "primereact/tag";
import type { AssetStatus } from "./use-fixed-assets";

const SEVERITY: Readonly<Record<AssetStatus, "secondary" | "success" | "info" | "danger">> = {
  DRAFT: "secondary",
  ACTIVE: "success",
  FULLY_DEPRECIATED: "info",
  DISPOSED: "danger",
};

export function AssetStatusTag({ status }: { readonly status: AssetStatus }): React.JSX.Element {
  const { t } = useTranslation();
  return <Tag value={t(`fixedAssets.status.${status}`)} severity={SEVERITY[status]} rounded />;
}
