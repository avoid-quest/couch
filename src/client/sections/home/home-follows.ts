import { useSyncExternalStore } from "react";
import { providerForUrl, type ProviderId } from "../../../shared/providers";

/**
 * A Home section that follows a list a source publishes (a season, a programme's episodes, a channel's videos), by
 * its address. Each device keeps its own, as it keeps Home's rows.
 */
export type HomeFollow = {
  id: FollowId;
  provider: ProviderId;
  url: string;
  /** The section's name on Home. */
  name: string;
  /** The list's own name at the source ("Puntate", "Season 2", "Videos"). */
  list: string;
};
export type FollowId = `follow:${string}`;

const storageKey = "couch.home-follows";
export const followId = (url: string): FollowId => `follow:${url}`;
export const isFollowId = (id: string): id is FollowId => id.startsWith("follow:");

const validName = (value: unknown): value is string =>
  typeof value === "string" &&
  value.trim().length > 0 &&
  value.length <= 300 &&
  !/[\u0000-\u001f\u007f]/.test(value);

function parse(raw: string | null): HomeFollow[] {
  try {
    const saved: unknown = JSON.parse(raw ?? "[]");
    if (!Array.isArray(saved)) return [];
    const follows: HomeFollow[] = [];
    for (const value of saved as Partial<HomeFollow>[]) {
      const url = typeof value?.url === "string" && value.url.length <= 4096 ? value.url : "";
      const provider = url ? providerForUrl(url) : undefined;
      if (!provider || provider !== value.provider || !validName(value.name)) continue;
      if (follows.some((follow) => follow.url === url)) continue;
      const list = validName(value.list) ? value.list : value.name;
      follows.push({ id: followId(url), provider, url, name: value.name, list });
    }
    return follows;
  } catch {
    return [];
  }
}

// Where storage is refused (a private window, a full disk), the follows live for this page's life and win over what
// storage still holds.
let unsaved: string | null = null;
let snapshot: { raw: string | null; follows: HomeFollow[] } = { raw: null, follows: [] };
export function readHomeFollows(): HomeFollow[] {
  let raw = unsaved;
  try {
    raw = unsaved ?? localStorage.getItem(storageKey);
  } catch {
    // Storage refused: keep the page's own copy.
  }
  if (raw !== snapshot.raw) snapshot = { raw, follows: parse(raw) };
  return snapshot.follows;
}

export function writeHomeFollows(follows: HomeFollow[]) {
  const raw = JSON.stringify(follows);
  try {
    localStorage.setItem(storageKey, raw);
    unsaved = null;
  } catch {
    unsaved = raw;
  }
  window.dispatchEvent(new Event(storageKey));
}

function subscribe(listener: () => void) {
  const fromOtherTab = (event: StorageEvent) => {
    if (event.key === storageKey || event.key === null) listener();
  };
  window.addEventListener("storage", fromOtherTab);
  window.addEventListener(storageKey, listener);
  return () => {
    window.removeEventListener("storage", fromOtherTab);
    window.removeEventListener(storageKey, listener);
  };
}

export const useHomeFollows = () => useSyncExternalStore(subscribe, readHomeFollows);

export function renameHomeFollow(id: FollowId, name: string) {
  writeHomeFollows(
    readHomeFollows().map((follow) =>
      follow.id === id ? { ...follow, name: name.trim() } : follow,
    ),
  );
}
