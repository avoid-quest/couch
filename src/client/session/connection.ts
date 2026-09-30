import type { ConnectionDetails } from "../../shared/devices";

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

// A deliberate browser switch carries public labels, while pairing stays in each origin's storage.
function receiveCouches() {
  if (typeof location === "undefined") return;
  const fragment = new URLSearchParams(location.hash.slice(1));
  if (!fragment.has("couches")) return;
  try { localStorage.setItem(couchesKey, JSON.stringify(unique([...couches(localStorage.getItem(couchesKey)), ...couches(fragment.get("couches"))]))); }
  catch { /* The current address still works without a saved list. */ }
  fragment.delete("couches");
  history.replaceState(history.state, "", location.pathname + location.search + (fragment.size ? `#${fragment}` : ""));
}

export function knownConnection(): KnownConnection | null {
  receiveCouches();
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "null") as KnownConnection | null;
    if (!value || typeof value.details?.name !== "string" || !Array.isArray(value.details.urls)) return null;
    if (![value.origin, ...value.details.urls].every(originOnly)) return null;
    return value;
  } catch { return null; }
}

export function knownConnections(): KnownCouch[] {
  const current = knownConnection();
  try { return unique([...couches(localStorage.getItem(couchesKey)), ...current ? [{ origin: current.origin, name: current.details.name }] : []]); }
  catch { return current ? [{ origin: current.origin, name: current.details.name }] : []; }
}

export function connectionHash(nameHash: string, current: KnownCouch) {
  const fragment = new URLSearchParams(nameHash.replace(/^#/, ""));
  fragment.set("couches", JSON.stringify(unique([...knownConnections(), current])));
  return `#${fragment}`;
}

export function rememberConnection(origin: string, details: ConnectionDetails) {
  const previous = knownConnections();
  try {
    localStorage.setItem(key, JSON.stringify({ origin, details }));
    localStorage.setItem(couchesKey, JSON.stringify(unique([...previous, { origin, name: details.name }])));
  } catch { /* The current address still works without saved labels. */ }
}

export function forgetConnection(origin: string) {
  const saved = knownConnections().filter(item => item.origin !== origin);
  try {
    if (knownConnection()?.origin === origin) localStorage.removeItem(key);
    localStorage.setItem(couchesKey, JSON.stringify(saved));
  } catch { /* Storage may be unavailable. */ }
}
