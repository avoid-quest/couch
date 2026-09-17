import { reorderedIds } from "@/lib/dnd";

export const nowSectionIds = ["playing", "history", "radio"] as const;
export type NowSectionId = typeof nowSectionIds[number];
export const nowSectionLabels: Record<NowSectionId, string> = { playing: "Now playing", history: "History", radio: "Live radio" };
const orderKey = "couch.now-section-order";
const sectionsKey = "couch.now-sections";

export type NowSections = { order: NowSectionId[]; hidden: NowSectionId[]; parts?: { current?: boolean; next?: boolean } };

const inList = (value: unknown): value is NowSectionId[] => Array.isArray(value) && value.every(id => nowSectionIds.includes(id as NowSectionId));

export function readNowSections(storage: Pick<Storage, "getItem"> = localStorage): NowSections {
  const validOrder = (value: unknown): NowSectionId[] | null =>
    inList(value) && value.length === nowSectionIds.length && new Set(value).size === value.length ? value : null;
  try {
    const parsed: unknown = JSON.parse(storage.getItem(sectionsKey) ?? "");
    if (parsed && typeof parsed === "object") {
      const { order, hidden } = parsed as Record<string, unknown>;
      const knownOrder = validOrder(order);
      if (knownOrder) {
        const parts = (parsed as Record<string, unknown>).parts;
        return { order: knownOrder, hidden: inList(hidden) ? hidden : [], parts: parts && typeof parts === "object" ? parts as NowSections["parts"] : undefined };
      }
    }
  } catch { /* fall through to the pre-customization order. */ }
  try {
    const legacy: unknown = JSON.parse(storage.getItem(orderKey) ?? "");
    return { order: validOrder(legacy) ?? [...nowSectionIds], hidden: [] };
  } catch { return { order: [...nowSectionIds], hidden: [] }; }
}

export function saveNowSections(sections: NowSections, storage: Pick<Storage, "setItem"> = localStorage) {
  storage.setItem(sectionsKey, JSON.stringify(sections));
}

export function moveNowSection(order: NowSectionId[], activeId: string, overId: string): NowSectionId[] | null {
  return reorderedIds(order, id => id, activeId, overId);
}
