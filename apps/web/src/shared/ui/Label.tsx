import * as LabelPrimitive from "@radix-ui/react-label";
import { cn } from "./cn";

export function Label({
  className,
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root>): React.JSX.Element {
  return (
    <LabelPrimitive.Root
      className={cn(
        "flex items-center gap-2 text-sm leading-none font-medium select-none text-foreground/90 peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
