export const settingsPages = {
  playback: { label: "Playback", path: "/settings/playback", manage: "always" },
  appearance: { label: "Appearance", path: "/settings/appearance", manage: "always" },
  connection: { label: "Remotes", path: "/settings/connection", manage: "administrator" },
  general: { label: "General", path: "/settings/tv", manage: "always" },
  sources: { label: "Sources", path: "/settings/sources", manage: "always" },
  "source-folders": { label: "Folders", path: "/settings/sources/folders", manage: "always" },
  "source-jellyfin": { label: "Jellyfin", path: "/settings/sources/jellyfin", manage: "always" },
  "source-iptv": { label: "Live TV", path: "/settings/sources/live-tv", manage: "always" },
  "source-radio": { label: "Radio playlists", path: "/settings/sources/radio", manage: "always" },
  "source-streaming-community": { label: "StreamingCommunity", path: "/settings/sources/streaming-community", manage: "always" },
  "source-metadata": { label: "Movie & show info", path: "/settings/sources/metadata", manage: "always" },
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
