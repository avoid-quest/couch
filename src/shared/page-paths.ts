import { settingsPageForPath, settingsPages } from "./settings-pages";

// Four destinations and the player. Sources are filters inside Find, not places.
export const pagePaths: Record<string, string> = {
  Home: "/", Now: "/now", Find: "/find", Saved: "/saved", Settings: "/settings",
};

// Old links keep working: sources became filters, the queue moved onto Home.
export const legacyPaths: Record<string, string> = {
  "/search": "/find", "/up-next": "/", "/browse": "/find", "/browse/library": "/find",
  "/browse/files": "/find", "/browse/online": "/find", "/browse/guide": "/find",
  "/browse/radio": "/find", "/browse/jellyfin": "/find",
};

export const frontendPaths = ["/music", "/radio", "/item", "/collection", "/settings/remotes", ...Object.values(pagePaths), ...Object.keys(legacyPaths), ...Object.values(settingsPages).map(page => page.path)];

export const sectionForPath = (pathname: string): string | undefined => {
  const clean = pathname.replace(/\/$/, "") || "/";
  if (clean === "/item" || clean === "/collection") return "Find";
  const section = Object.keys(pagePaths).find(name => pagePaths[name] === clean);
  if (section) return section;
  if (clean in legacyPaths) return sectionForPath(legacyPaths[clean]!);
  return settingsPageForPath(pathname) ? "Settings" : undefined;
};
export const pathForSection = (section: string) => pagePaths[section === "For later" ? "Saved" : section] ?? "/";
export const redirectForPath = (pathname: string): string | undefined => legacyPaths[pathname.replace(/\/$/, "") || "/"];
