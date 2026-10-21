import { useState } from "react";
import { readSectionRows, useSectionRows } from "../section-rows";

// Home's shelves, in the order a fresh device shows them. Each device keeps its own choice. What plays
// is not one: it leads Home as its hero, and a saved "now" row is dropped as unknown.
export const homeRowLabels = { continue: "Continue", later: "For later", radio: "Radio", recent: "Played recently", upNext: "Up next" } as const;
export type HomeRowId = keyof typeof homeRowLabels;
export type HomeRow = { id: HomeRowId; shown: boolean };
export const defaultHomeRows: HomeRow[] = [
  { id: "continue", shown: true }, { id: "later", shown: true },
  { id: "radio", shown: true }, { id: "recent", shown: true }, { id: "upNext", shown: false },
];
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
