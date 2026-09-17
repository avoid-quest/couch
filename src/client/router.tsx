import { createRouter } from "@tanstack/react-router";
import { QueryClient } from "@tanstack/react-query";
import { createAppHistory } from "./app-history";
import { routeTree } from "./routeTree.gen";

// Route guards read identity through the shared Query cache (beforeLoad).
export const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } });

export const router = createRouter({
  routeTree,
  context: { queryClient },
  history: createAppHistory(),
  scrollRestoration: false,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
