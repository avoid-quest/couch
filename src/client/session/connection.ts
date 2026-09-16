import type { ConnectionDetails } from "../../shared/controllers";

type KnownConnection = { origin: string; details: ConnectionDetails };
const key = "couch.connection";

export function knownConnection(): KnownConnection | null {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "null") as KnownConnection | null;
    if (!value || typeof value.details?.name !== "string" || !Array.isArray(value.details.urls)) return null;
    for (const origin of [value.origin, ...value.details.urls]) {
      const url = new URL(origin);
      if (!["http:", "https:"].includes(url.protocol) || url.origin !== origin) return null;
    }
    return value;
  } catch { return null; }
}

export function rememberConnection(origin: string, details: ConnectionDetails) {
  try { localStorage.setItem(key, JSON.stringify({ origin, details })); } catch { /* This tab retains its known TV while storage is unavailable. */ }
}
