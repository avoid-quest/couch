// The native webview uses these paths after #; the browser serves them directly.
export const pagePaths: Record<string, string> = {
  Home: "/", Search: "/search", Saved: "/saved", Queue: "/up-next", Settings: "/settings",
  Browse: "/browse", Library: "/browse/library", Online: "/browse/online",
  Guide: "/browse/guide", Radio: "/browse/radio", Jellyfin: "/browse/jellyfin",
};

export const sectionForPath = (pathname: string) => Object.entries(pagePaths).find(([, path]) => path === (pathname.replace(/\/$/, "") || "/"))?.[0];
export const pathForSection = (section: string) => pagePaths[section === "For later" ? "Saved" : section] ?? "/";
