import { createFileRoute, redirect } from "@tanstack/react-router";

// Library became Saved again; its tab comes along.
export const Route = createFileRoute("/library")({
  beforeLoad: ({ location }) => { throw redirect({ href: `/saved${location.searchStr}`, replace: true }); },
});
