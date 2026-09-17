import { reorderedIds } from "@/lib/dnd";

export const findSectionIds = ["continue", "recent", "folders", "forlater", "sources", "radio"] as const;
export type FindSectionId = typeof findSectionIds[number];
export const findSectionLabels: Record<FindSectionId, string> = { continue: "Continue playing", recent: "Recently played", folders: "TV folders", forlater: "For later", sources: "Sources", radio: "Live radio" };
const sectionsKey = "couch.find-sections";

export type FindSections = { order: FindSectionId[]; hidden: FindSectionId[] };

const inList = (value: unknown): value is FindSectionId[] => Array.isArray(value) && value.every(id => findSectionIds.includes(id as FindSectionId));

export function readFindSections(storage: Pick<Storage, "getItem"> = localStorage): FindSections {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(sectionsKey) ?? "");
    if (parsed && typeof parsed === "object") {
      const { order, hidden } = parsed as Record<string, unknown>;
      const knownOrder = inList(order) && order.length === findSectionIds.length && new Set(order).size === order.length ? order : null;
      if (knownOrder) return { order: knownOrder, hidden: inList(hidden) ? hidden : [] };
    }
  } catch { /* fall through to the default order. */ }
  return { order: [...findSectionIds], hidden: [] };
}

export function saveFindSections(sections: FindSections, storage: Pick<Storage, "setItem"> = localStorage) {
  storage.setItem(sectionsKey, JSON.stringify(sections));
}

export function moveFindSection(order: FindSectionId[], activeId: string, overId: string): FindSectionId[] | null {
  return reorderedIds(order, id => id, activeId, overId);
}
