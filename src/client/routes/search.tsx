import { createFileRoute, redirect } from "@tanstack/react-router";
import { SearchPage } from "../sections/find/SearchPage";
import { readSearchState } from "../search";

// An empty query is Home: what you were watching, the sources and what's on air.
export const Route = createFileRoute("/search")({
  beforeLoad: ({ location }) => { if (!readSearchState(location.searchStr).query) throw redirect({ href: "/", replace: true }); },
  component: SearchPage,
});
