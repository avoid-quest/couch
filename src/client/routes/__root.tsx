import { createRootRouteWithContext, Link, useRouter, type ErrorComponentProps } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import type { ControllerIdentity } from "../../shared/controllers";
import { useEffect } from "react";
import { AppShell } from "../sections/shell/AppShell";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

function RootError({ error }: ErrorComponentProps) {
  return (
    <Alert variant="destructive" className="m-4 w-auto rounded-none border-0 border-l-2 bg-transparent p-3"><AlertDescription className="flex flex-wrap items-center justify-between gap-4 text-sm"><span>{error instanceof Error ? error.message : String(error)}</span>
      <Button asChild><Link to="/">Back to Couch</Link></Button>
    </AlertDescription></Alert>
  );
}

// Unknown addresses behave like the old client: land on Now.
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
