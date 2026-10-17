import { createFileRoute, redirect } from "@tanstack/react-router";

// Live became Discover, which leads with what's on air.
export const Route = createFileRoute("/live")({
  beforeLoad: () => { throw redirect({ href: "/discover", replace: true }); },
});
