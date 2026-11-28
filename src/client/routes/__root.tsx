import {
  createRootRouteWithContext,
  Link,
  useRouter,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import type { DeviceIdentity } from "../../shared/devices";
import { useEffect } from "react";
import { AppShell } from "../sections/shell/AppShell";
import { RemotePlayerSession } from "../session/remote-player-session";
import { UpdateCenterProvider } from "../session/update-center";
import { Button } from "@/components/ui/button";
import { PageProblem } from "@/components/PageProblem";
import { TryAgain } from "@/components/TryAgain";

// With no header around it, the page keeps a way Home beside Try again.
function RootError({ error, reset }: ErrorComponentProps) {
  useEffect(() => console.error(error), [error]);
  return (
    <PageProblem error={error}>
      <TryAgain onClick={reset} />
      <Button variant="ghost" size="sm" asChild>
        <Link to="/">Back to Couch</Link>
      </Button>
    </PageProblem>
  );
}

// Unknown addresses behave like the old client: land on Home.
function NotFound() {
  const router = useRouter();
  useEffect(() => {
    router.history.replace("/");
  }, []);
  return null;
}

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient;
  identity: DeviceIdentity | null;
  localHost: boolean;
  connected: boolean;
}>()({
  component: () => (
    <UpdateCenterProvider>
      <RemotePlayerSession>
        <AppShell />
      </RemotePlayerSession>
    </UpdateCenterProvider>
  ),
  errorComponent: RootError,
  notFoundComponent: NotFound,
});
