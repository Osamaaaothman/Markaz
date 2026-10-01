import { useTranslation } from "react-i18next";
import { Button, type ButtonProps } from "primereact/button";

// Pages the user cannot open are hidden from the menu; for an action inside a page they CAN
// open, the button stays visible but disabled, with the reason on hover, instead of vanishing.
// The API still enforces the permission — this only stops offering an action that would be refused.
export function PermissionButton({
  allowed,
  disabled,
  ...props
}: ButtonProps & { readonly allowed: boolean }): React.JSX.Element {
  const { t } = useTranslation();
  const button = <Button {...props} disabled={!allowed || Boolean(disabled)} />;

  if (allowed) {
    return button;
  }
  // A disabled button swallows hover events, so the explanation sits on a wrapper.
  return (
    <span className="erp-no-permission" title={t("status.noPermission")}>
      {button}
    </span>
  );
}
