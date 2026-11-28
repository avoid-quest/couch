import type { ReactNode } from "react";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { coreSentence } from "@/api/client";
import { PAGE_PROBLEM } from "@/copy";

/**
 * A page that can't show at all, in the page's own space: what couldn't happen, Core's own sentence when it sent one
 * (never a script's error text), and its actions.
 */
export function PageProblem({ error, children }: { error?: unknown; children: ReactNode }) {
  const said = coreSentence(error);
  return (
    <main id="main" className="px-(--gutter) py-8">
      <Alert variant="destructive" className="max-w-prose">
        <AlertTitle className="text-body">{PAGE_PROBLEM}</AlertTitle>
        {said && <AlertDescription>{said}</AlertDescription>}
        <AlertAction>{children}</AlertAction>
      </Alert>
    </main>
  );
}
