import { type HTMLAttributes } from "react";
import { cn } from "./cn";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return (
    <div
      className={cn("flex flex-col gap-6 rounded-xl border border-border bg-card text-card-foreground shadow-sm", className)}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return <div className={cn("flex flex-col gap-1.5 px-6 pt-6", className)} {...props} />;
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>): React.JSX.Element {
  return <h2 className={cn("text-lg leading-none font-semibold tracking-tight", className)} {...props} />;
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>): React.JSX.Element {
  return <p className={cn("text-sm text-muted-foreground", className)} {...props} />;
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return <div className={cn("px-6", className)} {...props} />;
}

export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return <div className={cn("flex items-center px-6 pb-6", className)} {...props} />;
}
