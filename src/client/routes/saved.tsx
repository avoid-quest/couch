import { createFileRoute, redirect } from "@tanstack/react-router";

// Saved became Library; its tab comes along.
export const Route = createFileRoute("/saved")({
  beforeLoad: ({ location }) => { throw redirect({ href: `/library${location.searchStr}`, replace: true }); },
});
