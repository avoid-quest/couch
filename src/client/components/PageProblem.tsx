import type { ReactNode } from "react";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ApiError } from "@/api/client";
import { PAGE_PROBLEM } from "@/copy";

/**
 * A page that can't show at all, in the page's own space: what couldn't happen, Core's own sentence when it sent one
 * (never a script's error text), and its actions.
 */
export function PageProblem({
  title = PAGE_PROBLEM,
  error,
  children,
}: {
  title?: string;
  error?: unknown;
  children: ReactNode;
}) {
  const said = error instanceof ApiError ? error.message : undefined;
  return (
    <main id="main" className="px-(--gutter) py-8">
      <Alert variant="destructive" className="max-w-prose">
        <AlertTitle className="text-body">{title}</AlertTitle>
        {said && <AlertDescription>{said}</AlertDescription>}
        <AlertAction>{children}</AlertAction>
      </Alert>
    </main>
  );
}
