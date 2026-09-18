import { reorderedIds } from "@/lib/dnd";

export const nowSectionIds = ["playing", "queue", "history", "radio"] as const;
export type NowSectionId = typeof nowSectionIds[number];
export const nowSectionLabels: Record<NowSectionId, string> = { playing: "Now playing", queue: "Up next", history: "History", radio: "Live radio" };
const orderKey = "couch.now-section-order";
const sectionsKey = "couch.now-sections";

export type NowSections = { order: NowSectionId[]; hidden: NowSectionId[] };

const inList = (id: unknown): id is NowSectionId => nowSectionIds.includes(id as NowSectionId);

// Stored orders may predate a section: unknown ids are dropped and new ones are
// inserted at their canonical position (Up next right after Now playing).
const normalizeOrder = (order: unknown): NowSectionId[] => {
  const known = (Array.isArray(order) ? order : []).filter((id): id is NowSectionId => inList(id));
  const result = [...new Set(known)];
  for (const id of nowSectionIds) {
    if (result.includes(id)) continue;
    const anchor = nowSectionIds.slice(nowSectionIds.indexOf(id) + 1).find(later => result.includes(later));
    result.splice(anchor ? result.indexOf(anchor) : result.length, 0, id);
  }
  return result;
};

const validHidden = (value: unknown): NowSectionId[] => (Array.isArray(value) ? value.filter((id): id is NowSectionId => inList(id)) : []);

export function readNowSections(storage: Pick<Storage, "getItem"> = localStorage): NowSections {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(sectionsKey) ?? "");
    if (parsed && typeof parsed === "object") {
      const { order, hidden } = parsed as Record<string, unknown>;
      return { order: normalizeOrder(order), hidden: validHidden(hidden) };
    }
  } catch { /* fall through to the pre-customization order. */ }
  try {
    const legacy: unknown = JSON.parse(storage.getItem(orderKey) ?? "");
    return { order: normalizeOrder(legacy), hidden: [] };
  } catch { return { order: [...nowSectionIds], hidden: [] }; }
}

export function saveNowSections(sections: NowSections, storage: Pick<Storage, "setItem"> = localStorage) {
  storage.setItem(sectionsKey, JSON.stringify(sections));
}

export function moveNowSection(order: NowSectionId[], activeId: string, overId: string): NowSectionId[] | null {
  return reorderedIds(order, id => id, activeId, overId);
}
