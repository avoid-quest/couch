export const settingsPages = {
  general: { label: "General", path: "/settings/tv", manage: "always" },
  connection: { label: "Devices", path: "/settings/connection", manage: "always" },
  playback: { label: "Playback", path: "/settings/playback", manage: "always" },
  home: { label: "Home", path: "/settings/home", manage: "always" },
  appearance: { label: "Text size", path: "/settings/appearance", manage: "always" },
  sources: { label: "Sources", path: "/settings/sources", manage: "always" },
  "source-device-inputs": { label: "This device", path: "/settings/sources/device-inputs", manage: "always" },
  "source-iptv": { label: "Live TV", path: "/settings/sources/live-tv", manage: "always" },
  "source-radio": { label: "Radio playlists", path: "/settings/sources/radio", manage: "always" },
  "source-streaming-community": { label: "StreamingCommunity", path: "/settings/sources/streaming-community", manage: "always" },
  sound: { label: "Sound", path: "/settings/sound", manage: "administrator" },
  bluetooth: { label: "Bluetooth", path: "/settings/bluetooth", manage: "administrator" },
  display: { label: "Display", path: "/settings/display", manage: "administrator" },
  "tv-appearance": { label: "TV appearance", path: "/settings/tv-appearance", manage: "administrator" },
  updates: { label: "Updates", path: "/settings/updates", manage: "always" },
} as const;
export type SettingsPage = keyof typeof settingsPages;
export const settingsPageForPath = (pathname: string): SettingsPage | null =>
  (Object.keys(settingsPages) as SettingsPage[]).find(page => settingsPages[page].path === pathname.replace(/\/$/, "")) ?? null;
export const settingsPagePath = (page: SettingsPage | null) => page ? settingsPages[page].path : "/settings";
