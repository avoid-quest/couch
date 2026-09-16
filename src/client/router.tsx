import { createRouter } from "@tanstack/react-router";
import { createAppHistory } from "./app-history";
import { routeTree } from "./routeTree.gen";

export const router = createRouter({
  routeTree,
  history: createAppHistory(),
  scrollRestoration: false,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
