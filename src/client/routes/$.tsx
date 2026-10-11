import { createFileRoute, redirect } from "@tanstack/react-router";

// Unknown addresses behave like the old client: land on Now.
export const Route = createFileRoute("/$")({
  beforeLoad: () => { throw redirect({ href: "/" }); },
});
