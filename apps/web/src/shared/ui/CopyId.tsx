import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { copyToClipboard } from "../lib/copy-to-clipboard";

// A record id as a small button that copies the whole id. Ids are UUIDv7, whose first
// characters are a timestamp (rows created together share them), so the short form shows the
// random tail. The full id is in the tooltip, and `full` shows all of it (used in dialogs).
export function CopyId({ id, full = false }: { id: string; full?: boolean }): React.JSX.Element {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const onCopy = async (): Promise<void> => {
    if (!(await copyToClipboard(id))) return;
    setCopied(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button
      type="button"
      className={`erp-copy-id${full ? " erp-copy-id--full" : ""}${copied ? " erp-copy-id--done" : ""}`}
      title={id}
      aria-label={t(copied ? "actions.copied" : "actions.copyId")}
      onClick={() => void onCopy()}
    >
      <span className="erp-copy-id__text">{full ? id : `…${id.slice(-8)}`}</span>
      <i className={`pi ${copied ? "pi-check" : "pi-copy"}`} aria-hidden="true" />
    </button>
  );
}
