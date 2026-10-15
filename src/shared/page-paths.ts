import { settingsAliases, settingsPageForPath, settingsPages } from "./settings-pages";

// Main destinations and the player. Sources are filters inside Find, not places.
export const pagePaths: Record<string, string> = {
  Home: "/", Now: "/now", Find: "/find", Saved: "/saved", Settings: "/settings", Remote: "/remote",
};

export const frontendPaths = ["/item", "/collection", ...Object.values(pagePaths), ...Object.values(settingsPages).map(page => page.path), ...Object.keys(settingsAliases)];

export const sectionForPath = (pathname: string): string | undefined => {
  const clean = pathname.replace(/\/$/, "") || "/";
  if (clean === "/item" || clean === "/collection") return "Find";
  const section = Object.keys(pagePaths).find(name => pagePaths[name] === clean);
  if (section) return section;
  return settingsPageForPath(pathname) ? "Settings" : undefined;
};
export const pathForSection = (section: string) => pagePaths[section === "For later" ? "Saved" : section] ?? "/";
