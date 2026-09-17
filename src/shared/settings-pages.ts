export const settingsPages = {
  playback: { label: "Playback", path: "/settings/playback", manage: "always" },
  appearance: { label: "Appearance", path: "/settings/appearance", manage: "always" },
  connection: { label: "Connections", path: "/settings/connection", manage: "administrator" },
  general: { label: "General", path: "/settings/tv", manage: "always" },
  sources: { label: "Sources", path: "/settings/sources", manage: "always" },
  "source-folders": { label: "TV folders", path: "/settings/sources/folders", manage: "always" },
  "source-jellyfin": { label: "Jellyfin", path: "/settings/sources/jellyfin", manage: "always" },
  "source-radio": { label: "Radio", path: "/settings/sources/radio", manage: "always" },
  "source-metadata": { label: "Metadata", path: "/settings/sources/metadata", manage: "always" },
  "source-streaming-community": { label: "Streaming Community", path: "/settings/sources/streaming-community", manage: "always" },
  bluetooth: { label: "Bluetooth", path: "/settings/bluetooth", manage: "administrator" },
  sound: { label: "Sound", path: "/settings/sound", manage: "administrator" },
  display: { label: "Display", path: "/settings/display", manage: "administrator" },
  "tv-appearance": { label: "TV appearance", path: "/settings/tv-appearance", manage: "administrator" },
  updates: { label: "Updates", path: "/settings/updates", manage: "administrator" },
  advanced: { label: "Advanced", path: "/settings/advanced", manage: "administrator" },
} as const;
export type SettingsPage = keyof typeof settingsPages;
export const settingsPageForPath = (pathname: string): SettingsPage | null =>
  pathname.replace(/\/$/, "") === "/settings/remotes" ? "connection" : (Object.keys(settingsPages) as SettingsPage[]).find(page => settingsPages[page].path === pathname.replace(/\/$/, "")) ?? null;
export const settingsPagePath = (page: SettingsPage | null) => page ? settingsPages[page].path : "/settings";
