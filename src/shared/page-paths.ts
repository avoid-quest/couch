import { settingsPageForPath, settingsPages } from "./settings-pages";

// The native webview uses these paths after #; the browser serves them directly.
export const pagePaths: Record<string, string> = {
  Home: "/", Search: "/search", Saved: "/saved", Queue: "/up-next", Settings: "/settings",
  Browse: "/browse", Library: "/browse/library", Files: "/browse/files", Online: "/browse/online",
  Guide: "/browse/guide", Radio: "/browse/radio", Jellyfin: "/browse/jellyfin",
};

export const frontendPaths = ["/settings/remotes", ...Object.values(pagePaths), ...Object.values(settingsPages).map(page => page.path)];

export const sectionForPath = (pathname: string) => ["/search", "/browse"].includes(pathname.replace(/\/$/, "")) ? "Home" : settingsPageForPath(pathname) ? "Settings" : Object.entries(pagePaths).find(([, path]) => path === (pathname.replace(/\/$/, "") || "/"))?.[0];
export const pathForSection = (section: string) => pagePaths[section === "For later" ? "Saved" : ["Search", "Browse"].includes(section) ? "Home" : section] ?? "/";
