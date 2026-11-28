import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { CircleAlert, Info } from "lucide-react";
import { cn } from "@/lib/utils";

// A problem at the thing it belongs to (docs/design.md "Problems"): an icon, one sentence in ink and one action, in the
// thing's own place. No box, border or tinted text; only a problem's icon is red.
const alertVariants = cva(
  "group/alert flex w-full min-w-0 flex-wrap items-center gap-x-3.5 gap-y-2 py-2 text-left text-sm text-foreground tv:text-base",
  {
    variants: {
      variant: {
        default: "[&>[data-slot=alert-icon]]:text-muted-foreground",
        destructive: "[&>[data-slot=alert-icon]]:text-destructive",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Alert({
  className,
  variant,
  children,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  const Icon = variant === "destructive" ? CircleAlert : Info;
  return (
    <div
      data-slot="alert"
      role={variant === "destructive" ? "alert" : "status"}
      className={cn(alertVariants({ variant }), className)}
      {...props}
    >
      <Icon data-slot="alert-icon" aria-hidden="true" className="size-[1.15em] shrink-0" />
      {/* The sentence takes the line, so the action ends it and wraps under it on a narrow screen. */}
      <div className="grid min-w-0 flex-[1_1_14rem] gap-0.5">
        {React.Children.toArray(children).filter((child) => !isAction(child))}
      </div>
      {React.Children.toArray(children).filter(isAction)}
    </div>
  );
}

const isAction = (child: React.ReactNode) =>
  React.isValidElement(child) && child.type === AlertAction;

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn(
        "font-medium [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

/** The sentence, in ink; under a title it is the quieter next line. */
function AlertDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        "text-pretty [overflow-wrap:anywhere] group-has-data-[slot=alert-title]/alert:text-muted-foreground [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground [&_p:not(:last-child)]:mb-4",
        className,
      )}
      {...props}
    />
  );
}

function AlertAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-action"
      className={cn("flex shrink-0 flex-wrap gap-2", className)}
      {...props}
    />
  );
}

export { Alert, AlertTitle, AlertDescription, AlertAction };
