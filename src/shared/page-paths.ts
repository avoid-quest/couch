import { settingsAliases, settingsPageForPath, settingsPages } from "./settings-pages";

// The sections, the player and Where it plays' overview. Sources are filters inside Search, not places.
export const pagePaths: Record<string, string> = {
  Home: "/", Now: "/now", Live: "/live", Search: "/search", Library: "/library", Settings: "/settings", Remote: "/remote", "Where it plays": "/where-it-plays",
};
// Earlier sections, served so bookmarks reach their redirects (routes/find.tsx, routes/saved.tsx).
const earlierPaths = ["/find", "/saved"];

export const frontendPaths = ["/item", "/collection", ...Object.values(pagePaths), ...earlierPaths, ...Object.values(settingsPages).map(page => page.path), ...Object.keys(settingsAliases)];

// An item or collection page belongs to the section that opened it, which its URL carries as `from`, so its tab
// and breadcrumb survive a refresh. Without one, a station's belongs to Live and the rest to Search.
const detailSections = ["Home", "Live", "Search", "Library"];
const sectionFrom = (from: unknown) => detailSections.find(name => name.toLowerCase() === from);
export const detailFrom = (section: string | undefined) => detailSections.find(name => name === section)?.toLowerCase();
export const readFrom = (from: unknown) => sectionFrom(from)?.toLowerCase();

export const sectionForPath = (pathname: string, search = ""): string | undefined => {
  const clean = pathname.replace(/\/$/, "") || "/";
  if (clean === "/item" || clean === "/collection") {
    const query = new URLSearchParams(search);
    return sectionFrom(query.get("from")) ?? (query.get("kind") === "radio" ? "Live" : "Search");
  }
  const section = Object.keys(pagePaths).find(name => pagePaths[name] === clean);
  if (section) return section;
  return settingsPageForPath(pathname) ? "Settings" : undefined;
};
export const pathForSection = (section: string) => pagePaths[section === "For later" ? "Library" : section] ?? "/";
