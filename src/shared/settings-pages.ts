// Two scopes: this device (what changes only on the device in hand) and the Couch
// everyone shares, its hardware included. Groups split the Couch's longer list.
export const settingsPages = {
  general: { scope: "device", label: "General", path: "/settings/device/general" },
  connection: { scope: "device", label: "Couch connection", path: "/settings/device/connection" },
  viewing: { scope: "device", label: "Viewing", path: "/settings/device/viewing" },
  home: { scope: "device", label: "Home", path: "/settings/device/home" },
  discover: { scope: "device", label: "Discover", path: "/settings/device/discover" },
  sharing: { scope: "device", label: "Sharing", path: "/settings/device/sharing" },
  "device-updates": { scope: "device", label: "Updates", path: "/settings/device/updates" },
  couch: { scope: "couch", label: "General", path: "/settings/couch/general" },
  devices: { scope: "couch", group: "Access", label: "Devices", path: "/settings/couch/devices" },
  network: { scope: "couch", group: "Access", label: "Network", path: "/settings/couch/network" },
  playback: { scope: "couch", group: "Watching", label: "Playback", path: "/settings/couch/playback" },
  sources: { scope: "couch", group: "Watching", label: "Sources", path: "/settings/couch/sources" },
  "source-iptv": { scope: "couch", label: "Live TV", path: "/settings/couch/sources/live-tv" },
  "source-radio": { scope: "couch", label: "Radio playlists", path: "/settings/couch/sources/radio" },
  "source-streaming-community": { scope: "couch", label: "StreamingCommunity", path: "/settings/couch/sources/streaming-community" },
  sound: { scope: "couch", group: "Hardware", label: "Sound", path: "/settings/couch/sound" },
  bluetooth: { scope: "couch", group: "Hardware", label: "Bluetooth", path: "/settings/couch/bluetooth" },
  display: { scope: "couch", group: "Hardware", label: "Display", path: "/settings/couch/display" },
  updates: { scope: "couch", label: "Updates", path: "/settings/couch/updates" },
} as const;
export type SettingsPage = keyof typeof settingsPages;

// Earlier addresses, kept for bookmarks, docs and older Couch apps' links.
export const settingsAliases: Record<string, SettingsPage> = {
  "/settings/tv": "general",
  "/settings/connection": "devices",
  "/settings/playback": "playback",
  "/settings/home": "home",
  "/settings/appearance": "viewing",
  "/settings/sources": "sources",
  "/settings/sources/device-inputs": "sharing",
  "/settings/sources/live-tv": "source-iptv",
  "/settings/sources/radio": "source-radio",
  "/settings/sources/streaming-community": "source-streaming-community",
  "/settings/sound": "sound",
  "/settings/bluetooth": "bluetooth",
  "/settings/display": "display",
  "/settings/tv-appearance": "display",
  "/settings/updates": "updates",
};

export const settingsPageForPath = (pathname: string): SettingsPage | null =>
  (Object.keys(settingsPages) as SettingsPage[]).find(page => settingsPages[page].path === pathname.replace(/\/$/, "")) ?? null;
export const settingsPagePath = (page: SettingsPage | null) => page ? settingsPages[page].path : "/settings";
