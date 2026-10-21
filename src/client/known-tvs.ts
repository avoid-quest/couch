import type { DeviceSummary } from "../shared/protocol";

// Core knows a device is a TV only once it connects as one after Core starts. This browser remembers the TVs it has
// seen, so a TV that's off still reads as one (Remote, Devices).
const key = "couch.known-tvs";

/** The ids of the TVs among `devices`, as Core says now or as this browser saw before. */
export function knownTvs(devices: DeviceSummary[] | undefined) {
  const now = devices?.filter(device => device.tv).map(device => device.id) ?? [];
  try {
    const known: string[] = JSON.parse(localStorage.getItem(key) ?? "[]");
    const next = [...new Set([...now, ...known])].slice(0, 32);
    if (next.some((id, index) => known[index] !== id)) localStorage.setItem(key, JSON.stringify(next));
    return new Set(next);
  } catch { return new Set(now); }
}
