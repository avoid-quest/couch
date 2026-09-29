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

/** The header's "Playing on X +N": on a narrow header the name truncates, never the count (#644 ticket 12). */
export function PlayingLabel({ renderer }: { renderer: { here: boolean; name: string; more: number } | null }) {
  return <span className="flex min-w-0 max-w-48 gap-1 max-sm:max-w-40">
    <span className="truncate">{renderer && !renderer.here ? <><span className="max-sm:sr-only">Playing on </span>{renderer.name}</> : <><span className="max-sm:hidden">Playing here</span><span className="sm:hidden">Here</span></>}</span>
    {!!renderer?.more && <span className="shrink-0">+{renderer.more}</span>}
  </span>;
}

/** Filled while connected, hollow while not. */
export function StatusDot({ connected }: { connected: boolean }) {
  return <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full border border-current", connected && "bg-current")} />;
}
