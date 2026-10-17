import { createFileRoute, redirect } from "@tanstack/react-router";

// Live became Discover, which leads with what's on air. Its Stations and Channels kept their place in the address, so
// an address with theirs opens Discover's own page for them, keeping it.
const channels = [["group", "group"], ["channelPage", "page"], ["channelFilter", "filter"]] as const;
const stations = [["radioSource", "radioSource"], ["filter", "filter"], ["page", "page"]] as const;

export const Route = createFileRoute("/live")({
  beforeLoad: ({ location }) => {
    const old = new URLSearchParams(location.searchStr), next = new URLSearchParams();
    const tv = channels.some(([key]) => old.has(key));
    for (const [from, to] of tv ? channels : stations) { const value = old.get(from); if (value) next.set(to, value); }
    const path = tv ? "/discover/live-tv" : next.size ? "/discover/radio" : "/discover";
    throw redirect({ href: `${path}${next.size ? `?${next}` : ""}`, replace: true });
  },
});
