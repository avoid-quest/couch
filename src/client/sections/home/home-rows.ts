import { useMemo, useState } from "react";
import { readSectionRows, saveSectionRows, useSectionRows } from "../section-rows";
import {
  readHomeFollows,
  useHomeFollows,
  writeHomeFollows,
  type FollowId,
  type HomeFollow,
} from "./home-follows";

// Every kind of section Home can show: its name, on Home and in Edit Home, and what Edit Home says it holds. A new kind
// is one more entry here, a place in defaultHomeRows and what HomePage draws for it. Each device keeps its own choice;
// what plays is not one (it is the now-playing bar's), and a saved "now" row is dropped as unknown. Source IDs stay
// independent of their availability, contents and display names.
export const homeRows = {
  sources: { label: "Browse", note: "Doors to Radio, Live TV and the catalogues" },
  continue: { label: "Continue", note: "What you stopped part way through" },
  later: { label: "For later", note: "What you saved to play later" },
  recent: { label: "Played recently", note: "What you played to the end" },
  upNext: { label: "Up next", note: "What plays after this" },
  shared: { label: "Shared sources", note: "Screens and sound devices share" },
  radio: { label: "Radio", note: "Stations on air" },
  "live-tv": { label: "Live TV", note: "Channels from your playlists" },
  twitch: { label: "Twitch", note: "Channels you saved" },
  streamingcommunity: { label: "StreamingCommunity", note: "Films and series you saved" },
  raiplay: { label: "RaiPlay", note: "Programmes you saved" },
  movies123: { label: "123MoviesFree", note: "Films and series you saved" },
  animesaturn: { label: "AnimeSaturn", note: "Anime you saved" },
  animeunity: { label: "AnimeUnity", note: "Anime you saved" },
} as const satisfies Record<string, { label: string; note: string }>;
export type HomeRowId = keyof typeof homeRows;
export type HomeRow = { id: HomeRowId; shown: boolean };
/** Your own rows; the rest are the sources'. */
const ownRows: readonly HomeRowId[] = ["continue", "later", "recent", "upNext"];
const sourceRows: HomeRow[] = (Object.keys(homeRows) as HomeRowId[])
  .filter((id) => !ownRows.includes(id))
  .map((id) => ({ id, shown: true }));
// A device that ordered or hid Discover's sources before they moved here keeps that choice (couch.discover-rows),
// Browse included, where Discover had it.
const browseFirst = (() => {
  try {
    return localStorage.getItem("couch.discover-rows") === null;
  } catch {
    return true;
  }
})();
const discoverRows = readSectionRows("couch.discover-rows", sourceRows);
// A fresh device's Home: Browse, Continue (its followed sections join here), For later, Radio, then the other sources.
// Played recently lives in Saved → Played, so it starts off.
export const defaultHomeRows: HomeRow[] = [
  ...(browseFirst ? [{ id: "sources" as const, shown: true }] : []),
  { id: "continue", shown: true },
  { id: "later", shown: true },
  ...(browseFirst ? [{ id: "radio" as const, shown: true }] : []),
  ...discoverRows.filter((row) => !browseFirst || (row.id !== "sources" && row.id !== "radio")),
  { id: "recent", shown: false },
  { id: "upNext", shown: false },
];
export const readHomeRows = (storage?: Pick<Storage, "getItem">) =>
  readSectionRows("couch.home-rows", defaultHomeRows, storage);
export const useHomeRows = () => {
  const follows = useHomeFollows();
  return useSectionRows<HomeSectionId>(
    "couch.home-rows",
    useMemo(() => withFollows(follows), [follows]),
  );
};

/** Home's own rows and the sections that follow a source's list. */
export type HomeSectionId = HomeRowId | FollowId;
type HomeLayoutRow = { id: HomeSectionId; shown: boolean };
/** Home's default rows, its followed sections newest first right after Continue: where Add and Reset put them. */
const withFollows = (follows: HomeFollow[]): { id: HomeSectionId; shown: boolean }[] => {
  const rows: { id: HomeSectionId; shown: boolean }[] = [...defaultHomeRows];
  rows.splice(
    rows.findIndex((row) => row.id === "continue") + 1,
    0,
    ...follows.map((follow) => ({ id: follow.id, shown: true })).reverse(),
  );
  return rows;
};
const homeLayout = () => ({
  follows: readHomeFollows(),
  rows: readSectionRows<HomeSectionId>("couch.home-rows", withFollows(readHomeFollows())),
});

/** Adds a section that follows `follow`'s list right after Continue, where it is seen; returns its undo. */
export function addHomeFollow(follow: HomeFollow) {
  const before = homeLayout();
  const follows = [...before.follows.filter((other) => other.id !== follow.id), follow];
  const rows = before.rows.filter((row) => row.id !== follow.id);
  rows.splice(rows.findIndex((row) => row.id === "continue") + 1, 0, {
    id: follow.id,
    shown: true,
  });
  writeHomeFollows(follows);
  saveSectionRows("couch.home-rows", rows);
  return () => void removeHomeFollow(follow.id);
}

/**
 * Takes a followed section off Home; what was saved or played from it stays. Its undo puts back only that section,
 * after the row it followed, into Home as it is then, so other changes made since stay.
 */
export function removeHomeFollow(id: FollowId) {
  const before = homeLayout();
  const follow = before.follows.find((other) => other.id === id);
  const at = before.rows.findIndex((row) => row.id === id);
  writeHomeFollows(before.follows.filter((other) => other.id !== id));
  saveSectionRows(
    "couch.home-rows",
    before.rows.filter((row) => row.id !== id),
  );
  return () => {
    if (!follow || at < 0) return;
    const now = homeLayout();
    const rows = now.rows.filter((row) => row.id !== id);
    const after = rows.findIndex((row) => row.id === before.rows[at - 1]?.id);
    rows.splice(after >= 0 ? after + 1 : Math.min(at, rows.length), 0, before.rows[at]!);
    writeHomeFollows([...now.follows.filter((other) => other.id !== id), follow]);
    saveSectionRows("couch.home-rows", rows);
  };
}

/** Shows or hides one of Home's sections in Home as it is now, so an Undo changes only that section. */
export function setHomeSectionShown(id: HomeSectionId, shown: boolean) {
  saveSectionRows(
    "couch.home-rows",
    homeLayout().rows.map((row) => (row.id === id ? { ...row, shown } : row)),
  );
}

/**
 * Moves one of Home's sections past the next one `over` (the next section Home shows), so the move is seen. Returns
 * its undo, which puts back only that section where it was, or nothing when it can't move that way.
 */
export function moveHomeSection(
  id: HomeSectionId,
  by: -1 | 1,
  over: (id: HomeSectionId) => boolean,
) {
  const rows = homeLayout().rows;
  const from = rows.findIndex((row) => row.id === id);
  let to = from + by;
  while (to >= 0 && to < rows.length && !over(rows[to]!.id)) to += by;
  if (from < 0 || to < 0 || to >= rows.length) return;
  saveSectionRows("couch.home-rows", placed(rows, id, to));
  return () => saveSectionRows("couch.home-rows", placed(homeLayout().rows, id, from));
}
const placed = (rows: HomeLayoutRow[], id: HomeSectionId, at: number) => {
  const row = rows.find((other) => other.id === id);
  if (!row) return rows;
  const next = rows.filter((other) => other !== row);
  next.splice(Math.min(at, next.length), 0, row);
  return next;
};

/** Items in the order Home first showed them: known ones keep their place, new ones follow in their own order. */
export function keptOrder<T>(
  order: readonly string[],
  items: readonly T[],
  key: (item: T) => string,
): T[] {
  const rank = new Map(order.map((id, index) => [id, index]));
  return items
    .map((item, index) => ({ item, rank: rank.get(key(item)) ?? order.length + index }))
    .sort((a, b) => a.rank - b.rank)
    .map(({ item }) => item);
}

/**
 * A row's order, taken once its data is ready, so nothing moves under the focus while Home stays open. What was
 * `playing` then is the player's and stays out until Home opens again; an item that starts playing later keeps its
 * place, and one Home hadn't shown yet waits for the next visit while it plays.
 */
export function useKeptOrder<T>(
  items: T[],
  key: (item: T) => string,
  ready = true,
  playing: (item: T) => boolean = () => false,
): T[] {
  // State set while rendering, as React suggests for remembering a render: an abandoned render takes its snapshot with it.
  const [kept, setKept] = useState<{ order: string[]; left: string[] } | null>(null);
  const left = kept?.left ?? items.filter(playing).map(key);
  const shown = items.filter((item) => !left.includes(key(item)));
  // An empty first answer takes no order, or the items that arrive later would never be kept.
  const taken = kept ?? (ready && shown.length ? { order: shown.map(key), left } : null);
  if (taken && !kept) setKept(taken);
  if (!taken) return shown;
  return keptOrder(
    taken.order,
    shown.filter((item) => taken.order.includes(key(item)) || !playing(item)),
    key,
  );
}
