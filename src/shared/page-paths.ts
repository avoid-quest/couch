import { settingsAliases, settingsPageForPath, settingsPages } from "./settings-pages";

// The sections, the player and Where it plays' overview. Sources are filters inside Search, not places.
export const pagePaths: Record<string, string> = {
  Home: "/", Now: "/now", Live: "/live", Search: "/search", Library: "/library", Settings: "/settings", Remote: "/remote", "Where it plays": "/where-it-plays",
};
// Earlier sections, served so bookmarks reach their redirects (routes/find.tsx, routes/saved.tsx).
const earlierPaths = ["/find", "/saved"];

export const frontendPaths = ["/item", "/collection", ...Object.values(pagePaths), ...earlierPaths, ...Object.values(settingsPages).map(page => page.path), ...Object.keys(settingsAliases)];

export const sectionForPath = (pathname: string): string | undefined => {
  const clean = pathname.replace(/\/$/, "") || "/";
  if (clean === "/item" || clean === "/collection") return "Search";
  const section = Object.keys(pagePaths).find(name => pagePaths[name] === clean);
  if (section) return section;
  return settingsPageForPath(pathname) ? "Settings" : undefined;
};
export const pathForSection = (section: string) => pagePaths[section === "For later" ? "Library" : section] ?? "/";
