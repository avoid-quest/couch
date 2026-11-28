import type { ReactNode } from "react";
import { CircleAlert } from "lucide-react";
import { Dismiss, dismissOnEscape, useDismiss } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

/**
 * One quiet line for the whole app's state, in its one place (docs/design.md "Problems"): a Spinner while Couch works
 * on it by itself, otherwise a problem's red icon, then one sentence in ink and its actions. Dismissed, it stays away
 * until the state changes; a line with actions (Reload after an update) keeps them, so it has no Dismiss.
 */
export function StatusLine({
  busy = false,
  actions,
  dismissible = !actions,
  children,
  className,
}: {
  busy?: boolean;
  actions?: ReactNode;
  /** Off for plain progress ("Starting…"), which goes by itself. */
  dismissible?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const { ref, dismissed, dismiss } = useDismiss<HTMLDivElement>();
  return (
    <div
      ref={ref}
      role="status"
      hidden={dismissed}
      onKeyDown={dismissible ? dismissOnEscape(dismiss) : undefined}
      data-status-line
      className={cn(
        "flex min-h-8 flex-wrap items-center gap-x-2.5 gap-y-1 text-sm text-foreground tv:text-base",
        className,
      )}
    >
      {busy ? (
        <Spinner
          role="presentation"
          aria-hidden="true"
          aria-label={undefined}
          className="size-3.5 text-muted-foreground"
        />
      ) : (
        <CircleAlert aria-hidden="true" className="size-[1.15em] shrink-0 text-destructive" />
      )}
      <span className="min-w-0">{children}</span>
      {actions && <span className="flex flex-wrap gap-2">{actions}</span>}
      {dismissible && <Dismiss onClick={dismiss} />}
    </div>
  );
}
