import * as AvatarPrimitive from "@radix-ui/react-avatar";
import { cn } from "./cn";

export const Avatar = ({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Root>): React.JSX.Element => (
  <AvatarPrimitive.Root
    className={cn("flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary", className)}
    {...props}
  />
);

export const AvatarFallback = ({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Fallback>): React.JSX.Element => (
  <AvatarPrimitive.Fallback
    className={cn("text-xs font-medium text-primary-foreground", className)}
    {...props}
  />
);
