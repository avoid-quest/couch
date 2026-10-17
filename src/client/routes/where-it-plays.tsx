import { createFileRoute, redirect } from "@tanstack/react-router";

// Where it plays' overview became the picker alone, one step away on every page: its address opens Home.
export const Route = createFileRoute("/where-it-plays")({
  beforeLoad: () => { throw redirect({ href: "/", replace: true }); },
});
