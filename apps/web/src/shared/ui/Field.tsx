import { type ReactNode } from "react";
import { cn } from "./cn";
import { Label } from "./Label";

export interface FieldProps {
  htmlFor?: string;
  label: ReactNode;
  error?: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}

export function Field({ htmlFor, label, error, hint, children, className }: FieldProps): React.JSX.Element {
  return (
    <div className={cn("flex min-w-0 flex-1 flex-col gap-1.5", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? (
        <p className="text-xs font-medium text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
