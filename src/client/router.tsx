import { createRouter } from "@tanstack/react-router";
import { createAppHistory } from "./app-history";
import { routeTree } from "./routeTree.gen";

// SessionGate supplies the current client and identity through RouterProvider.
// There is deliberately no application-wide credential or QueryClient singleton.
export const router = createRouter({
  routeTree,
  context: { queryClient: undefined!, identity: null, connected: false },
  history: createAppHistory(),
  scrollRestoration: false,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
