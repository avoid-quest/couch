import { normalizeDeviceName, type ConnectionDetails } from "../../shared/devices";

type KnownConnection = { origin: string; details: ConnectionDetails };
type KnownCouch = { origin: string; name: string };
const key = "couch.connection";
const couchesKey = "couch.connections";
const originOnly = (value: unknown) => {
  try { const url = new URL(String(value)); return ["http:", "https:"].includes(url.protocol) && url.origin === value; }
  catch { return false; }
};
const couches = (value: string | null): KnownCouch[] => {
  try {
    const entries: unknown = JSON.parse(value ?? "[]");
    return Array.isArray(entries) ? entries.filter(item => item && originOnly(item.origin) && typeof item.name === "string" && item.name.length <= 60).map(({ origin, name }) => ({ origin, name })) : [];
  } catch { return []; }
};
const unique = (entries: KnownCouch[]) => [...new Map(entries.map(item => [item.origin, item])).values()];

const save = (storageKey: string, value: unknown) => { const text = JSON.stringify(value); if (localStorage.getItem(storageKey) !== text) localStorage.setItem(storageKey, text); };
const referrer = () => { try { return new URL(document.referrer).origin; } catch { return ""; } };

export function knownConnection(): KnownConnection | null {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "null") as KnownConnection | null;
    if (!value || typeof value.details?.name !== "string" || !Array.isArray(value.details.urls)) return null;
    if (![value.origin, ...value.details.urls].every(originOnly)) return null;
    return value;
  } catch { return null; }
}

/** Whether the page that sent this browser here is a Couch it already saved at this origin, read before any hint is taken. */
export const fromSavedCouch = typeof location !== "undefined" && knownConnections().some(item => item.origin === referrer());

/**
 * The name a browser switching from another Couch carried here, read before device-id.ts takes it.
 * Any page may suggest it for pairing, where it shows in the name field; only a saved Couch may save it.
 */
export const suggestedDeviceName = (() => {
  try { return typeof location === "undefined" ? null : normalizeDeviceName(new URLSearchParams(location.hash.slice(1)).get("device-name")); }
  catch { return null; }
})();

// A deliberate browser switch carries public labels, while pairing stays in each origin's storage. A
// saved Couch may share its whole list; any other page adds at most itself, so a link cannot plant others.
if (typeof location !== "undefined") {
  const fragment = new URLSearchParams(location.hash.slice(1));
  if (fragment.has("couches")) {
    const carried = couches(fragment.get("couches"));
    const accepted = fromSavedCouch ? carried : carried.filter(item => item.origin === referrer()).slice(0, 1);
    try { if (accepted.length) save(couchesKey, unique([...couches(localStorage.getItem(couchesKey)), ...accepted])); }
    catch { /* The current address still works without a saved list. */ }
    fragment.delete("couches");
    history.replaceState(history.state, "", location.pathname + location.search + (fragment.size ? `#${fragment}` : ""));
  }
}

export function knownConnections(): KnownCouch[] {
  const current = knownConnection();
  try { return unique([...couches(localStorage.getItem(couchesKey)), ...current ? [{ origin: current.origin, name: current.details.name }] : []]); }
  catch { return current ? [{ origin: current.origin, name: current.details.name }] : []; }
}

// The saved list goes only to a Couch already on it; a new address learns just where this browser came from.
export function connectionHash(nameHash: string, current: KnownCouch, target: string) {
  const fragment = new URLSearchParams(nameHash.replace(/^#/, ""));
  const saved = unique([...knownConnections(), current]);
  fragment.set("couches", JSON.stringify(saved.some(item => item.origin === target) ? saved : [current]));
  return `#${fragment}`;
}

export function rememberConnection(origin: string, details: ConnectionDetails) {
  const previous = knownConnections();
  try {
    save(key, { origin, details });
    save(couchesKey, unique([...previous, { origin, name: details.name }]));
  } catch { /* The current address still works without saved labels. */ }
}

export function forgetConnection(origin: string) {
  const saved = knownConnections().filter(item => item.origin !== origin);
  try {
    if (knownConnection()?.origin === origin) localStorage.removeItem(key);
    localStorage.setItem(couchesKey, JSON.stringify(saved));
  } catch { /* Storage may be unavailable. */ }
}
