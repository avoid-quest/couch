// One flat list. This device and Home & Discover change only the device in hand; the rest are the Couch everyone
// shares. Sound, TV and Updates appear when the Couch has them (settings-scope.ts).
export const settingsPages = {
  device: { label: "This device", path: "/settings/device" },
  home: { label: "Home & Discover", path: "/settings/home" },
  devices: { label: "Devices & network", path: "/settings/devices" },
  playback: { label: "Playback", path: "/settings/playback" },
  sources: { label: "Sources", path: "/settings/sources" },
  "source-iptv": { label: "Live TV", path: "/settings/sources/live-tv" },
  "source-radio": { label: "Radio playlists", path: "/settings/sources/radio" },
  "source-streaming-community": { label: "StreamingCommunity", path: "/settings/sources/streaming-community" },
  sound: { label: "Sound", path: "/settings/sound" },
  display: { label: "TV", path: "/settings/display" },
  updates: { label: "Updates", path: "/settings/updates" },
} as const;
export type SettingsPage = keyof typeof settingsPages;

// Earlier addresses, kept for bookmarks, docs and older Couch apps' links.
export const settingsAliases: Record<string, SettingsPage> = {
  "/settings/tv": "device",
  "/settings/appearance": "device",
  "/settings/connection": "devices",
  "/settings/sources/device-inputs": "device",
  "/settings/bluetooth": "sound",
  "/settings/tv-appearance": "display",
  "/settings/device/general": "device",
  "/settings/device/connection": "device",
  "/settings/device/viewing": "device",
  "/settings/device/sharing": "device",
  "/settings/device/home": "home",
  "/settings/device/discover": "home",
  "/settings/device/updates": "updates",
  "/settings/couch/general": "devices",
  "/settings/couch/devices": "devices",
  "/settings/couch/network": "devices",
  "/settings/couch/playback": "playback",
  "/settings/couch/sources": "sources",
  "/settings/couch/sources/live-tv": "source-iptv",
  "/settings/couch/sources/radio": "source-radio",
  "/settings/couch/sources/streaming-community": "source-streaming-community",
  "/settings/couch/sound": "sound",
  "/settings/couch/bluetooth": "sound",
  "/settings/couch/display": "display",
  "/settings/couch/updates": "updates",
};

export const settingsPageForPath = (pathname: string): SettingsPage | null =>
  (Object.keys(settingsPages) as SettingsPage[]).find(page => settingsPages[page].path === pathname.replace(/\/$/, "")) ?? null;
export const settingsPagePath = (page: SettingsPage | null) => page ? settingsPages[page].path : "/settings";
