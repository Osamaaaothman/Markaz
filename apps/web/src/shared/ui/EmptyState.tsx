import { Button } from "primereact/button";

export interface EmptyStateAction {
  readonly label: string;
  readonly onClick: () => void;
}

export interface EmptyStateProps {
  readonly icon?: string | undefined;
  readonly title: string;
  readonly hint?: string | undefined;
  readonly action?: EmptyStateAction | undefined;
}

// A list with nothing in it: a soft oversized icon, one line of text, and, where the person may create
// the thing, the button that does it.
export function EmptyState({ icon = "pi pi-inbox", title, hint, action }: EmptyStateProps): React.JSX.Element {
  return (
    <div className="mk-empty">
      <span className="mk-empty__icon" aria-hidden="true">
        <i className={icon} />
      </span>
      <strong className="mk-empty__title">{title}</strong>
      {hint ? <span className="mk-empty__hint">{hint}</span> : null}
      {action ? <Button type="button" label={action.label} icon="pi pi-plus" onClick={action.onClick} /> : null}
    </div>
  );
}
