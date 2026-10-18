import { createFileRoute, redirect } from "@tanstack/react-router";
import { SearchPage } from "../sections/find/SearchPage";
import { readSearchState } from "../search";

// An empty query is Discover: the sources and what's on air.
export const Route = createFileRoute("/search")({
  beforeLoad: ({ location }) => { if (!readSearchState(location.searchStr).query) throw redirect({ href: "/discover", replace: true }); },
  component: SearchPage,
});
