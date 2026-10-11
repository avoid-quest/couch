import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { offline, TRY_AGAIN } from "@/copy";
import { useOptionalSessionGate } from "@/session/session-context";

// The messages every Saved tab shows around its rows (docs/design.md "Messages").

/** Status line while offline or loading. */
export function SavedStatus({ connected, loading }: { connected: boolean; loading: boolean }) {
  const name = useOptionalSessionGate()?.state?.installationName;
  if (connected && !loading) return null;
  return <p role="status" className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
    {connected && <Spinner aria-hidden="true" role="presentation" />}{connected ? "Loading…" : offline(name)}
  </p>;
}

/** A load or action error, with Try again when the page can retry. */
export function SavedError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <Alert variant="destructive" className="mb-4">
    <AlertDescription>{message}</AlertDescription>
    {onRetry && <AlertAction><Button variant="outline" size="sm" onClick={onRetry}>{TRY_AGAIN}</Button></AlertAction>}
  </Alert>;
}

/** An empty tab: what goes here and the next step. */
export function SavedEmpty({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return <Empty className="pt-0">
    <EmptyHeader><EmptyDescription>{children}</EmptyDescription></EmptyHeader>
    {action && <EmptyContent>{action}</EmptyContent>}
  </Empty>;
}

/**
 * Keeps focus in a list when a row goes away: once the row is gone and the
 * list is idle, focus the row that took its place, or the fallback.
 */
export function useRemovalFocus(ids: string[], ready: boolean, list: RefObject<HTMLElement | null>, fallback: () => HTMLElement | null | undefined) {
  const removed = useRef<{ id: string; index: number } | null>(null);
  useEffect(() => {
    const target = removed.current;
    if (!target || !ready || ids.includes(target.id)) return;
    removed.current = null;
    const rows = list.current?.children;
    (rows?.[Math.min(target.index, rows.length - 1)]?.querySelector<HTMLElement>("button:not(:disabled)") ?? fallback())?.focus();
  });
  return (id: string, index: number) => { removed.current = { id, index }; };
}
