import { cloneElement, useId, type ReactElement, type ReactNode } from "react";

/** A persistent caption: placeholders disappear as soon as a line is filled. */
export function LineField({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactElement;
  hint?: ReactNode;
}): React.JSX.Element {
  const id = useId();
  return (
    <div className="erp-line-field">
      <span id={id} className="erp-line-field__label">
        {label}
      </span>
      {cloneElement(children as ReactElement<{ "aria-labelledby"?: string }>, {
        "aria-labelledby": id,
      })}
      {hint}
    </div>
  );
}
