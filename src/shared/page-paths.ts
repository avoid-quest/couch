import { settingsAliases, settingsPageForPath, settingsPages } from "./settings-pages";

// The sections in tab order, then the search results and the player. Sources are shelves on Discover, not places.
export const pagePaths: Record<string, string> = {
  Home: "/", Discover: "/discover", Saved: "/saved", Remote: "/remote", Settings: "/settings", Search: "/search", Now: "/now",
};
// Discover's own pages: every station, and every Live TV channel.
export const discoverPaths = ["/discover/radio", "/discover/live-tv"];
// Earlier pages, served so bookmarks reach their redirects (routes/find.tsx, live.tsx, library.tsx, where-it-plays.tsx).
const earlierPaths = ["/find", "/live", "/library", "/where-it-plays"];

export const frontendPaths = ["/item", "/collection", ...Object.values(pagePaths), ...discoverPaths, ...earlierPaths, ...Object.values(settingsPages).map(page => page.path), ...Object.keys(settingsAliases)];

// An item or collection page belongs to the section that opened it, which its URL carries as `from`, so its tab
// and breadcrumb survive a refresh. Without one, it belongs to Discover, where the sources and stations are.
const detailSections = ["Home", "Discover", "Search", "Saved"];
const sectionFrom = (from: unknown) => detailSections.find(name => name.toLowerCase() === from);
export const detailFrom = (section: string | undefined) => detailSections.find(name => name === section)?.toLowerCase();
export const readFrom = (from: unknown) => sectionFrom(from)?.toLowerCase();

export const sectionForPath = (pathname: string, search = ""): string | undefined => {
  const clean = pathname.replace(/\/$/, "") || "/";
  if (clean === "/item" || clean === "/collection") return sectionFrom(new URLSearchParams(search).get("from")) ?? "Discover";
  if (discoverPaths.includes(clean)) return "Discover";
  const section = Object.keys(pagePaths).find(name => pagePaths[name] === clean);
  if (section) return section;
  return settingsPageForPath(pathname) ? "Settings" : undefined;
};
export const pathForSection = (section: string) => pagePaths[section === "For later" ? "Saved" : section] ?? "/";
