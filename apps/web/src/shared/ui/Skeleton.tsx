import { cn } from "./cn";

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return <div className={cn("animate-pulse rounded-md bg-secondary", className)} {...props} />;
}
