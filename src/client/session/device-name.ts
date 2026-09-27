import { isNativeHost } from "./native-context";

const key = "couch.device-name";
const legacyKey = "couch.remote-name";

export function deviceNameDefault() {
  return isNativeHost() ? "Couch computer" : "Couch browser";
}

// Browser storage belongs to this origin and profile; paired Core names take precedence.
export function clientDeviceName(pairedName?: string | null) {
  if (pairedName) return pairedName;
  try {
    const saved = localStorage.getItem(key) || localStorage.getItem(legacyKey);
    if (saved && saved !== "My remote") return saved;
  } catch { /* Storage may be unavailable. */ }
  return deviceNameDefault();
}

export function rememberClientDeviceName(name: string) {
  try { localStorage.setItem(key, name); localStorage.removeItem(legacyKey); } catch { /* The Core still stores paired names. */ }
}
