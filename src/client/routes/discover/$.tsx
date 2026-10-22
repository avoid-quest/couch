import { createFileRoute, redirect } from "@tanstack/react-router";

// Discover folded into Home: its address opens Home, and its own pages (every station, every channel) kept theirs under Home.
export const Route = createFileRoute("/discover/$")({
  beforeLoad: ({ location, params }) => {
    const page = ["radio", "live-tv"].includes(params._splat ?? "") ? `/${params._splat}` : "/";
    throw redirect({ href: page === "/" ? "/" : `${page}${location.searchStr}`, replace: true });
  },
});
