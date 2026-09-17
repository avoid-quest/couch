import { reorderedIds } from "@/lib/dnd";

export const nowSectionIds = ["playing", "history", "radio"] as const;
export type NowSectionId = typeof nowSectionIds[number];
export const nowSectionLabels: Record<NowSectionId, string> = { playing: "Now playing", history: "History", radio: "Live radio" };
const storageKey = "couch.now-section-order";

export function readNowSectionOrder(storage: Pick<Storage, "getItem"> = localStorage): NowSectionId[] {
  try {
    const value: unknown = JSON.parse(storage.getItem(storageKey) ?? "");
    return Array.isArray(value) && value.length === nowSectionIds.length && new Set(value).size === value.length
      && value.every(id => nowSectionIds.includes(id as NowSectionId)) ? value as NowSectionId[] : [...nowSectionIds];
  } catch { return [...nowSectionIds]; }
}

export function saveNowSectionOrder(order: NowSectionId[], storage: Pick<Storage, "setItem"> = localStorage) {
  storage.setItem(storageKey, JSON.stringify(order));
}

export function moveNowSection(order: NowSectionId[], activeId: string, overId: string): NowSectionId[] | null {
  return reorderedIds(order, id => id, activeId, overId);
}
