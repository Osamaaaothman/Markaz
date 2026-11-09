import { useTranslation } from "react-i18next";
import { LogoMark } from "./Logo";

// One loading kit, three shapes, each for its own place:
//   PageSkeleton (PageSkeleton.tsx): a list or detail screen whose layout is known; shows its outline.
//   Spinner / PanelLoader: a small area (dialog body, side panel, one card), or inline beside a label.
//   PageLoader: the whole app is not ready yet (first sign-in, session restore); shows the logo.

export interface SpinnerProps {
  readonly size?: "sm" | "md" | "lg";
  readonly label?: string | undefined;
}

export function Spinner({ size = "md", label }: SpinnerProps): React.JSX.Element {
  const { t } = useTranslation();
  return <span className={`mk-spinner mk-spinner--${size}`} role="status" aria-label={label ?? t("status.loading")} />;
}

export function PanelLoader({ label }: { readonly label?: string | undefined }): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="mk-panel-loader" aria-busy="true">
      <Spinner size="lg" label={label} />
      <span>{label ?? t("status.loading")}</span>
    </div>
  );
}

export function PageLoader({ label }: { readonly label?: string | undefined }): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="mk-page-loader" role="status" aria-busy="true" aria-live="polite">
      <LogoMark size={76} animate="loop" />
      <span>{label ?? t("status.loading")}</span>
    </div>
  );
}
