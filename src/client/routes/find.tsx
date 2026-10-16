import { createFileRoute, redirect } from "@tanstack/react-router";

// Find became Search, and its Radio and Live TV browse became Live: earlier addresses open the section that now holds them.
// Live TV shares Live with Radio, so its page and filter take their own names there (BrowseLiveTv).
export const Route = createFileRoute("/find")({
  beforeLoad: ({ location }) => {
    const search = new URLSearchParams(location.searchStr), browse = search.get("browse");
    search.delete("browse");
    if (browse === "live-tv") for (const [from, to] of [["page", "channelPage"], ["filter", "channelFilter"]] as const) {
      const value = search.get(from);
      search.delete(from);
      if (value !== null) search.set(to, value);
    }
    throw redirect({ href: `${browse === "radio" || browse === "live-tv" ? "/live" : "/search"}${search.size ? `?${search}` : ""}`, replace: true });
  },
});
