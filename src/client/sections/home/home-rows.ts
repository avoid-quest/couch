import { useState } from "react";
import { readSectionRows, useSectionRows } from "../section-rows";

// Home's sections, in the order a fresh device shows them: yours first (what you were watching, saved for later and
// played, which share one board), then the sources (Discover folded into Home). Each device keeps its own choice.
// What plays is not one: it leads Home as its Stage, and a saved "now" row is dropped as unknown. Source IDs stay
// independent of their availability, contents and display names.
export const homeRowLabels = {
  continue: "Continue", later: "For later", recent: "Played recently", upNext: "Up next",
  shared: "Shared sources", radio: "Radio", "live-tv": "Live TV", twitch: "Twitch",
  streamingcommunity: "StreamingCommunity", raiplay: "RaiPlay", movies123: "123MoviesFree",
  animesaturn: "AnimeSaturn", animeunity: "AnimeUnity", sources: "Sources",
} as const;
export type HomeRowId = keyof typeof homeRowLabels;
export type HomeRow = { id: HomeRowId; shown: boolean };
/** Your own rows, which Home sets as one board of short lists rather than shelves. */
export const boardRows: readonly HomeRowId[] = ["continue", "later", "recent", "upNext"];
export const defaultHomeRows: HomeRow[] = (Object.keys(homeRowLabels) as HomeRowId[]).map(id => ({ id, shown: id !== "upNext" }));
export const readHomeRows = (storage?: Pick<Storage, "getItem">) => readSectionRows("couch.home-rows", defaultHomeRows, storage);
export const useHomeRows = () => useSectionRows("couch.home-rows", defaultHomeRows);

/** Items in the order Home first showed them: known ones keep their place, new ones follow in their own order. */
export function keptOrder<T>(order: readonly string[], items: readonly T[], key: (item: T) => string): T[] {
  const rank = new Map(order.map((id, index) => [id, index]));
  return items.map((item, index) => ({ item, rank: rank.get(key(item)) ?? order.length + index })).sort((a, b) => a.rank - b.rank).map(({ item }) => item);
}

/**
 * A row's order, taken once its data is ready, so nothing moves under the focus while Home stays open.
 * It leaves out the item that led Home then and the one that leads it now (`except`, the hero's): the hero's item is
 * never in a shelf too, so a hero that changes (after Stop) takes its item out of the shelf below.
 */
export function useKeptOrder<T>(items: T[], key: (item: T) => string, ready = true, except?: string): T[] {
  // State set while rendering, as React suggests for remembering a render: an abandoned render takes its snapshot with it.
  const [kept, setKept] = useState<{ order: string[]; except?: string } | null>(null);
  // An empty first answer takes no order, or the items that arrive later would never be kept.
  const taken = kept ?? (ready && items.some(item => key(item) !== except) ? { order: items.map(key).filter(id => id !== except), except } : null);
  if (taken && !kept) setKept(taken);
  const shown = items.filter(item => key(item) !== except && (!taken || key(item) !== taken.except));
  return taken ? keptOrder(taken.order, shown, key) : shown;
}
