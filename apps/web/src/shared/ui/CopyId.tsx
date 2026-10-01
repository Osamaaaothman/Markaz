import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { copyToClipboard } from "../lib/copy-to-clipboard";

// A record's human-readable reference (e.g. "ACC-000217"), as a small button that copies it.
// `uuid`, when given, is the record's real primary key — shown only in the tooltip, for support
// or a direct database lookup; the visible, copied text is always the short readable ref.
export function CopyId({ value, uuid }: { value: string; uuid?: string }): React.JSX.Element {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const onCopy = async (): Promise<void> => {
    if (!(await copyToClipboard(value))) return;
    setCopied(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button
      type="button"
      className={`erp-copy-id${copied ? " erp-copy-id--done" : ""}`}
      title={uuid ?? value}
      aria-label={t(copied ? "actions.copied" : "actions.copyId")}
      onClick={() => void onCopy()}
    >
      <span className="erp-copy-id__text">{value}</span>
      <i className={`pi ${copied ? "pi-check" : "pi-copy"}`} aria-hidden="true" />
    </button>
  );
}
