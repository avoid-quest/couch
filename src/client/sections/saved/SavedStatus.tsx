import { MediaRowsSkeleton } from "@/components/LoadingMedia";
import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { TryAgain } from "@/components/TryAgain";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";

// The messages every Saved tab shows around its rows (docs/design.md "Messages").

/** Rows waiting to load. */
export function SavedStatus({ connected, loading }: { connected: boolean; loading: boolean }) {
  // Out of reach, the header says so (docs/design.md, Problems); the page keeps what it showed.
  return connected && loading ? <MediaRowsSkeleton /> : null;
}

/** A load or action error, with Try again when the page can retry. */
export function SavedError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Alert variant="destructive" className="mb-4">
      <AlertDescription>{message}</AlertDescription>
      {onRetry && (
        <AlertAction>
          <TryAgain onClick={onRetry} />
        </AlertAction>
      )}
    </Alert>
  );
}

/** An empty tab: what goes here and the next step. */
export function SavedEmpty({
  title,
  children,
  action,
}: {
  title?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <Empty className="py-0">
      <EmptyHeader>
        {title && (
          <EmptyTitle>
            <h2>{title}</h2>
          </EmptyTitle>
        )}
        <EmptyDescription>{children}</EmptyDescription>
      </EmptyHeader>
      {action && <EmptyContent>{action}</EmptyContent>}
    </Empty>
  );
}

/**
 * Keeps focus in a list when a row goes away: once the row is gone and the
 * list is idle, focus the row that took its place, or the fallback.
 */
export function useRemovalFocus(
  ids: string[],
  ready: boolean,
  list: RefObject<HTMLElement | null>,
  fallback: () => HTMLElement | null | undefined,
) {
  const removed = useRef<{ id: string; index: number } | null>(null);
  useEffect(() => {
    const target = removed.current;
    if (!target || !ready || ids.includes(target.id)) return;
    removed.current = null;
    const rows = list.current?.children;
    (
      rows?.[Math.min(target.index, rows.length - 1)]?.querySelector<HTMLElement>(
        "a[href], button:not(:disabled)",
      ) ?? fallback()
    )?.focus();
  });
  return (id: string, index: number) => {
    removed.current = { id, index };
  };
}
