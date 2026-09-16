import { createRootRoute, Outlet } from "@tanstack/react-router";

// Placeholder root so the router plugin can generate the tree. The router
// layer replaces this with SessionGate, the navigation rail and an error
// boundary.
export const Route = createRootRoute({ component: Outlet });
