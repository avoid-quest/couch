import { createRootRouteWithContext, Link, useRouter, type ErrorComponentProps } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { SessionGate } from "@/session/session-context";
import { AppShell } from "../sections/shell/AppShell";
import { Button } from "@/components/ui/button";

function RootError({ error }: ErrorComponentProps) {
  return (
    <div className="notice error-notice" role="alert">
      <span>{error instanceof Error ? error.message : String(error)}</span>
      <Button asChild><Link to="/">Back to Couch</Link></Button>
    </div>
  );
}

// Unknown addresses behave like the old client: land on Now.
function NotFound() {
  const router = useRouter();
  useEffect(() => { router.history.replace("/"); }, []);
  return null;
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: () => <SessionGate><AppShell /></SessionGate>,
  errorComponent: RootError,
  notFoundComponent: NotFound,
});
