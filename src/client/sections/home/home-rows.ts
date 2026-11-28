import { useState } from "react";
import { readSectionRows, useSectionRows } from "../section-rows";

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
/** Your own rows, which Home sets as one board of short lists rather than shelves. */
export const boardRows: readonly HomeRowId[] = ["continue", "later", "recent", "upNext"];
const sourceRows: HomeRow[] = (Object.keys(homeRows) as HomeRowId[])
  .filter((id) => !boardRows.includes(id))
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
// A fresh device's Home: Browse, Continue, For later, then the sources, then the rest of your own.
export const defaultHomeRows: HomeRow[] = [
  ...(browseFirst ? [{ id: "sources" as const, shown: true }] : []),
  { id: "continue", shown: true },
  { id: "later", shown: true },
  ...discoverRows.filter((row) => !browseFirst || row.id !== "sources"),
  { id: "recent", shown: true },
  { id: "upNext", shown: false },
];
export const readHomeRows = (storage?: Pick<Storage, "getItem">) =>
  readSectionRows("couch.home-rows", defaultHomeRows, storage);
export const useHomeRows = () => useSectionRows("couch.home-rows", defaultHomeRows);

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
 * A row's order, taken once its data is ready, so nothing moves under the focus while Home stays open.
 * It leaves out the item that led Home then and the one that leads it now (`except`, the hero's): the hero's item is
 * never in a shelf too, so a hero that changes (after Resume) takes its item out of the shelf below.
 */
export function useKeptOrder<T>(
  items: T[],
  key: (item: T) => string,
  ready = true,
  except?: string,
): T[] {
  // State set while rendering, as React suggests for remembering a render: an abandoned render takes its snapshot with it.
  const [kept, setKept] = useState<{ order: string[]; except?: string } | null>(null);
  // An empty first answer takes no order, or the items that arrive later would never be kept.
  const taken =
    kept ??
    (ready && items.some((item) => key(item) !== except)
      ? { order: items.map(key).filter((id) => id !== except), except }
      : null);
  if (taken && !kept) setKept(taken);
  const shown = items.filter(
    (item) => key(item) !== except && (!taken || key(item) !== taken.except),
  );
  return taken ? keptOrder(taken.order, shown, key) : shown;
}
