import { createFileRoute, redirect } from "@tanstack/react-router";

// Live became Home's sources, which lead with what's on air. Its Stations and Channels kept their place in the address,
// so an address with theirs opens Home's own page for them (every station, every channel), keeping it.
const channels = [["group", "group"], ["channelPage", "page"], ["channelFilter", "filter"]] as const;
const stations = [["radioSource", "radioSource"], ["filter", "filter"], ["page", "page"]] as const;

export const Route = createFileRoute("/live")({
  beforeLoad: ({ location }) => {
    const old = new URLSearchParams(location.searchStr), next = new URLSearchParams();
    const tv = channels.some(([key]) => old.has(key));
    for (const [from, to] of tv ? channels : stations) { const value = old.get(from); if (value) next.set(to, value); }
    const path = tv ? "/live-tv" : next.size ? "/radio" : "/";
    throw redirect({ href: `${path}${next.size ? `?${next}` : ""}`, replace: true });
  },
});
