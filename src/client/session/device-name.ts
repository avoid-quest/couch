import { isNativeHost } from "./native-context";

const key = "couch.device-name";
const legacyKey = "couch.remote-name";

export function deviceNameDefault(nativeName?: string) {
  if (isNativeHost() && nativeName?.trim()) return nativeName.trim();
  if (typeof navigator === "undefined") return isNativeHost() ? "Couch computer" : "Couch browser";
  const agent = navigator.userAgent;
  const hints = (navigator as Navigator & { userAgentData?: { platform: string; brands: { brand: string }[]; mobile: boolean } }).userAgentData;
  const platform = hints?.platform || navigator.platform || agent;
  const device = /iPhone|iPod/i.test(agent) ? "iPhone" : /iPad/i.test(agent) || /Mac/i.test(platform) && navigator.maxTouchPoints > 1 ? "iPad"
    : /Android/i.test(platform + agent) ? hints?.mobile || /Mobile/i.test(agent) ? "Android phone" : "Android tablet"
    : /Mac/i.test(platform) ? "Mac" : /Win/i.test(platform) ? "Windows PC" : /Linux/i.test(platform) ? "Linux computer" : null;
  const brands = hints?.brands.map(value => value.brand) ?? [];
  const browser = brands.includes("Microsoft Edge") || /Edg(?:e|A|iOS)?\//i.test(agent) ? "Edge"
    : brands.includes("Google Chrome") || /(?:Chrome|CriOS)\//i.test(agent) ? "Chrome"
    : /(?:Firefox|FxiOS)\//i.test(agent) ? "Firefox" : /Safari\//i.test(agent) ? "Safari" : brands.includes("Chromium") ? "Chromium" : null;
  return device ? `${device} · ${isNativeHost() ? "Couch app" : browser ?? "browser"}` : isNativeHost() ? "Couch computer" : browser ? `${browser} browser` : "Couch browser";
}

// Browser storage belongs to this origin and profile; paired Core names take precedence.
export function clientDeviceName(pairedName?: string | null, nativeName?: string) {
  if (pairedName) return pairedName;
  try {
    const saved = localStorage.getItem(key) || localStorage.getItem(legacyKey);
    if (saved && saved !== "My remote") return saved;
  } catch { /* Storage may be unavailable. */ }
  return deviceNameDefault(nativeName);
}

export function rememberClientDeviceName(name: string) {
  try { localStorage.setItem(key, name); localStorage.removeItem(legacyKey); } catch { /* The Core still stores paired names. */ }
}
