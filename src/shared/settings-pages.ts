// Two owners: this device's pages change only the device in hand, the Couch's change it for every device. Sound, TV
// and the Updates pages appear when there is that hardware or updater (settings-scope.ts).
export const settingsPages = {
  device: { owner: "device", label: "General", path: "/settings/device" },
  home: { owner: "device", label: "Home", path: "/settings/device/home" },
  "device-updates": { owner: "device", label: "Updates", path: "/settings/device/updates" },
  devices: { owner: "couch", label: "Devices & network", path: "/settings/couch/devices" },
  playback: { owner: "couch", label: "Playback", path: "/settings/couch/playback" },
  sources: { owner: "couch", label: "Sources", path: "/settings/couch/sources" },
  "source-iptv": { owner: "couch", label: "Live TV", path: "/settings/couch/sources/live-tv" },
  "source-radio": { owner: "couch", label: "Radio playlists", path: "/settings/couch/sources/radio" },
  "source-streaming-community": { owner: "couch", label: "StreamingCommunity", path: "/settings/couch/sources/streaming-community" },
  sound: { owner: "couch", label: "Sound", path: "/settings/couch/sound" },
  display: { owner: "couch", label: "TV", path: "/settings/couch/tv" },
  updates: { owner: "couch", label: "Updates", path: "/settings/couch/updates" },
} as const;
export type SettingsPage = keyof typeof settingsPages;

// Earlier addresses, kept for bookmarks, docs and older Couch apps' links.
export const settingsAliases: Record<string, SettingsPage> = {
  "/settings/tv": "device",
  "/settings/appearance": "device",
  "/settings/sources/device-inputs": "device",
  "/settings/device/general": "device",
  "/settings/device/connection": "device",
  "/settings/device/viewing": "device",
  "/settings/device/sharing": "device",
  "/settings/home": "home",
  "/settings/device/discover": "home",
  "/settings/devices": "devices",
  "/settings/connection": "devices",
  "/settings/couch/general": "devices",
  "/settings/couch/network": "devices",
  "/settings/playback": "playback",
  "/settings/sources": "sources",
  "/settings/sources/live-tv": "source-iptv",
  "/settings/sources/radio": "source-radio",
  "/settings/sources/streaming-community": "source-streaming-community",
  "/settings/sound": "sound",
  "/settings/bluetooth": "sound",
  "/settings/couch/bluetooth": "sound",
  "/settings/display": "display",
  "/settings/couch/display": "display",
  "/settings/tv-appearance": "display",
  "/settings/updates": "updates",
};

export const settingsPageForPath = (pathname: string): SettingsPage | null =>
  (Object.keys(settingsPages) as SettingsPage[]).find(page => settingsPages[page].path === pathname.replace(/\/$/, "")) ?? null;
export const settingsPagePath = (page: SettingsPage | null) => page ? settingsPages[page].path : "/settings";
