import { useTranslation } from "react-i18next";

export function StockHint({
  onHand,
  exceeded,
}: {
  onHand: string | null;
  exceeded: boolean;
}): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <small
      className={exceeded || onHand === null ? "erp-field__error" : "erp-field__hint"}
      role={exceeded ? "alert" : undefined}
    >
      {onHand === null
        ? t("inventory.stockLevels.unavailable")
        : t("inventory.stockLevels.availableQuantity", { quantity: onHand })}
      {exceeded ? ` — ${t("inventory.stockLevels.exceeded")}` : ""}
    </small>
  );
}
