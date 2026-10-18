import { createFileRoute, redirect } from "@tanstack/react-router";

// Find became Search, and its Radio and Live TV browse became Discover's own pages: earlier addresses open what now holds them.
export const Route = createFileRoute("/find")({
  beforeLoad: ({ location }) => {
    const search = new URLSearchParams(location.searchStr), browse = search.get("browse");
    search.delete("browse");
    const path = browse === "radio" ? "/discover/radio" : browse === "live-tv" ? "/discover/live-tv" : "/search";
    throw redirect({ href: `${path}${search.size ? `?${search}` : ""}`, replace: true });
  },
});
