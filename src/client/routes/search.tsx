import { createFileRoute, redirect } from "@tanstack/react-router";
import { SearchPage } from "../sections/find/SearchPage";
import { readSearchState } from "../search";

// An empty query is Home: what you were watching, the sources and what's on air.
export const Route = createFileRoute("/search")({
  beforeLoad: ({ location }) => {
    const searchState = readSearchState(location.searchStr);
    if (!searchState.query) throw redirect({ href: "/", replace: true });
    return { searchState };
  },
  component: SearchPage,
});
