import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { CircleAlert, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

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
  dismissible = true,
  children,
  ...props
}: React.ComponentProps<"div"> &
  VariantProps<typeof alertVariants> & {
    /** False only where its action is the one way on (a page that can't show): hiding it would hide that. */
    dismissible?: boolean;
  }) {
  const Icon = variant === "destructive" ? CircleAlert : Info;
  const { ref, dismissed, dismiss } = useDismiss<HTMLDivElement>();
  return (
    <div
      ref={ref}
      data-slot="alert"
      role={variant === "destructive" ? "alert" : "status"}
      hidden={dismissed}
      className={cn(alertVariants({ variant }), className)}
      onKeyDown={dismissible ? dismissOnEscape(dismiss) : undefined}
      {...props}
    >
      <Icon data-slot="alert-icon" aria-hidden="true" className="size-[1.15em] shrink-0" />
      {/* The sentence takes the line, so the action ends it and wraps under it on a narrow screen. */}
      <div className="grid min-w-0 flex-[1_1_14rem] gap-0.5">
        {React.Children.toArray(children).filter((child) => !isAction(child))}
      </div>
      {React.Children.toArray(children).filter(isAction)}
      {dismissible && <Dismiss onClick={dismiss} />}
    </div>
  );
}

/**
 * A problem line put away (docs/design.md "Dismissing"): it stays mounted but hidden until what it says changes, and
 * shows again when it comes back (mounts again). Focus inside it moves to the control before it.
 */
function useDismiss<T extends HTMLElement>() {
  const ref = React.useRef<T>(null);
  const [said, setSaid] = React.useState<string | null>(null);
  React.useLayoutEffect(() => {
    if (said !== null && ref.current?.textContent !== said) setSaid(null);
  });
  const dismiss = () => {
    const line = ref.current;
    if (!line) return;
    if (line.contains(document.activeElement)) focusBefore(line);
    setSaid(line.textContent ?? "");
  };
  return { ref, dismissed: said !== null, dismiss };
}

const focusable =
  'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';
function focusBefore(line: HTMLElement) {
  const controls = [...document.querySelectorAll<HTMLElement>(focusable)].filter(
    (control) => control.checkVisibility() && !line.contains(control),
  );
  const before = controls.filter(
    (control) => control.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
  (before.at(-1) ?? controls[0])?.focus();
}

/** Escape, or a remote's Back (navigation.ts sends it as Escape), on a focused line puts it away. */
const dismissOnEscape = (dismiss: () => void) => (event: React.KeyboardEvent) => {
  if (event.key !== "Escape" || event.defaultPrevented) return;
  event.preventDefault();
  dismiss();
};

/** The one Dismiss on every problem line and message: an ×, last on its line. */
function Dismiss({ onClick }: { onClick: () => void }) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Dismiss"
      title="Dismiss"
      data-dismiss
      className="ml-auto shrink-0 text-muted-foreground hover:text-foreground"
      onClick={onClick}
    >
      <X aria-hidden="true" />
    </Button>
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

export { Alert, AlertTitle, AlertDescription, AlertAction, Dismiss, dismissOnEscape, useDismiss };
