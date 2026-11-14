import { useTranslation } from "react-i18next";

export function StockHint({
  onHand,
  exceeded,
  scope = "warehouse",
}: {
  onHand: string | null;
  exceeded: boolean;
  scope?: "warehouse" | "company";
}): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <small
      className={exceeded || onHand === null ? "erp-field__warning" : "erp-field__hint"}
      role={exceeded ? "alert" : undefined}
    >
      {onHand === null
        ? t("inventory.stockLevels.unavailable")
        : t(scope === "company" ? "inventory.stockLevels.availableCompanyQuantity" : "inventory.stockLevels.availableQuantity", { quantity: onHand })}
      {exceeded ? ` — ${t("inventory.stockLevels.exceeded")}` : ""}
    </small>
  );
}
