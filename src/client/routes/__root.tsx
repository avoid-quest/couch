import { createRootRouteWithContext, Link, useRouter, type ErrorComponentProps } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import type { DeviceIdentity } from "../../shared/devices";
import { useEffect } from "react";
import { AppShell } from "../sections/shell/AppShell";
import { RemotePlayerSession } from "../session/remote-player-session";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

function RootError({ error, reset }: ErrorComponentProps) {
  return (
    <main id="main" className="px-(--gutter) py-6">
      <Alert variant="destructive"><AlertDescription>{error instanceof Error ? error.message : String(error)}</AlertDescription>
        <div className="col-span-full flex flex-wrap gap-2"><Button variant="ghost" size="sm" onClick={reset}>Try again</Button><Button variant="ghost" size="sm" asChild><Link to="/">Back to Couch</Link></Button></div>
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

export const Route = createRootRouteWithContext<{ queryClient: QueryClient; identity: DeviceIdentity | null; connected: boolean }>()({
  component: () => <RemotePlayerSession><AppShell /></RemotePlayerSession>,
  errorComponent: RootError,
  notFoundComponent: NotFound,
});
