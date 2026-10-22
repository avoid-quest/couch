import { settingsAliases, settingsPageForPath, settingsPages } from "./settings-pages";

// The sections in tab order, then the search results and the player. Sources are shelves on Home, not places.
export const pagePaths: Record<string, string> = {
  Home: "/", Saved: "/saved", Remote: "/remote", Settings: "/settings", Search: "/search", Now: "/now",
};
// Home's own pages: every station, and every Live TV channel.
export const browsePaths = ["/radio", "/live-tv"];
// Where a TV's pairing code leads an admin's phone (routes/pair/tv.tsx), before that phone has opened Couch.
const pairingPaths = ["/pair/tv"];
// Earlier pages, served so bookmarks reach their redirects (routes/find.tsx, live.tsx, library.tsx, where-it-plays.tsx,
// discover/): Discover folded into Home.
const earlierPaths = ["/find", "/live", "/library", "/where-it-plays", "/discover", "/discover/radio", "/discover/live-tv"];

export const frontendPaths = ["/item", "/collection", ...Object.values(pagePaths), ...browsePaths, ...pairingPaths, ...earlierPaths, ...Object.values(settingsPages).map(page => page.path), ...Object.keys(settingsAliases)];

// An item or collection page belongs to the section that opened it, which its URL carries as `from`, so its tab
// and breadcrumb survive a refresh. Without one (or from Discover, which folded into Home), it belongs to Home, where
// the sources and stations are.
const detailSections = ["Home", "Search", "Saved"];
const sectionFrom = (from: unknown) => detailSections.find(name => name.toLowerCase() === from);
export const detailFrom = (section: string | undefined) => detailSections.find(name => name === section)?.toLowerCase();
export const readFrom = (from: unknown) => sectionFrom(from)?.toLowerCase();

export const sectionForPath = (pathname: string, search = ""): string | undefined => {
  const clean = pathname.replace(/\/$/, "") || "/";
  if (clean === "/item" || clean === "/collection") return sectionFrom(new URLSearchParams(search).get("from")) ?? "Home";
  if (browsePaths.includes(clean)) return "Home";
  const section = Object.keys(pagePaths).find(name => pagePaths[name] === clean);
  if (section) return section;
  return settingsPageForPath(pathname) ? "Settings" : undefined;
};
export const pathForSection = (section: string) => pagePaths[section === "For later" ? "Saved" : section] ?? "/";
