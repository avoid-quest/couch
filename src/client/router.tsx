import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

// SessionGate supplies the current client and identity through RouterProvider.
// There is deliberately no application-wide credential or QueryClient singleton.
export const router = createRouter({
  routeTree,
  context: { queryClient: undefined!, identity: null, localHost: false, connected: false },
  scrollRestoration: true,
  scrollToTopSelectors: [".tv-browser", ".app-page"],
  defaultPreload: "intent",
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
