export const settingsPages = {
  playback: { label: "Playback", path: "/settings/playback" },
  appearance: { label: "Appearance", path: "/settings/appearance" },
  connection: { label: "Connection", path: "/settings/connection" },
  general: { label: "TV", path: "/settings/tv" },
  sources: { label: "Sources", path: "/settings/sources" },
  "source-folders": { label: "TV folders", path: "/settings/sources/folders" },
  "source-jellyfin": { label: "Jellyfin", path: "/settings/sources/jellyfin" },
  "source-radio": { label: "Radio", path: "/settings/sources/radio" },
  "source-metadata": { label: "Metadata", path: "/settings/sources/metadata" },
  "source-streaming-community": { label: "Streaming Community", path: "/settings/sources/streaming-community" },
  bluetooth: { label: "Bluetooth", path: "/settings/bluetooth" },
  sound: { label: "Sound", path: "/settings/sound" },
  display: { label: "Display", path: "/settings/display" },
  "tv-appearance": { label: "TV appearance", path: "/settings/tv-appearance" },
  remotes: { label: "Paired remotes", path: "/settings/remotes" },
  updates: { label: "Updates", path: "/settings/updates" },
  advanced: { label: "Advanced", path: "/settings/advanced" },
} as const;
export type SettingsPage = keyof typeof settingsPages;
export const settingsPageForPath = (pathname: string): SettingsPage | null =>
  (Object.keys(settingsPages) as SettingsPage[]).find(page => settingsPages[page].path === pathname.replace(/\/$/, "")) ?? null;
export const settingsPagePath = (page: SettingsPage | null) => page ? settingsPages[page].path : "/settings";
