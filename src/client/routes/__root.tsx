import { createRootRouteWithContext, Link, useRouter, type ErrorComponentProps } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import type { ControllerIdentity } from "../../shared/controllers";
import { useEffect } from "react";
import { AppShell } from "../sections/shell/AppShell";
import { Button } from "@/components/ui/button";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";

function RootError({ error, reset }: ErrorComponentProps) {
  return (
    <main id="main" className="px-(--gutter) py-6">
      <Alert variant="destructive"><AlertDescription>{error instanceof Error ? error.message : String(error)}</AlertDescription>
        <AlertAction><Button variant="ghost" size="sm" onClick={reset}>Try again</Button><Button variant="ghost" size="sm" asChild><Link to="/">Back to Couch</Link></Button></AlertAction>
      </Alert>
    </main>
  );
}

// Unknown addresses behave like the old client: land on Home.
function NotFound() {
  const router = useRouter();
  useEffect(() => { router.history.replace("/"); }, []);
  return null;
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient; identity: ControllerIdentity | null; connected: boolean }>()({
  component: AppShell,
  errorComponent: RootError,
  notFoundComponent: NotFound,
});
