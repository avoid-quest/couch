import type { ReactNode } from "react";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

/** One quiet line under the header for connection and player state. */
export function StatusLine({ busy = false, actions, children, className }: { busy?: boolean; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div role="status" data-status-line className={cn("flex min-h-8 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground", className)}>
      {busy ? <Spinner role="presentation" aria-hidden="true" aria-label={undefined} className="size-3.5" /> : <StatusDot connected={false} />}
      <span className="min-w-0">{children}</span>
      {actions && <span className="flex flex-wrap gap-1">{actions}</span>}
    </div>
  );
}

/** Filled while connected, hollow while not. */
export function StatusDot({ connected }: { connected: boolean }) {
  return <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full border border-current", connected && "bg-current")} />;
}
