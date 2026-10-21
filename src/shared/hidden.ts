import type { CollectionLink, MediaCollection } from "./media";

/** What the Couch keeps out of its browse pages: one item (by source and address) or every item mentioning a word. */
export type HiddenRule = { id: string; kind: "item" | "word"; value: string; label: string; createdAt: number };
export type HiddenCandidate = { provider: string; url: string; title: string; subtitle?: string; creator?: CollectionLink; collection?: MediaCollection };

/** An item rule's value: the source and address, which outlive a catalogue's ids. */
export const hiddenItemKey = (item: Pick<HiddenCandidate, "provider" | "url">) => `${item.provider}:${item.url}`;

/** Whether any rule hides the item: an item rule by its key, a word rule anywhere in its title, subtitle, creator or collection. */
export function matchesHidden(rules: readonly HiddenRule[], item: HiddenCandidate) {
  if (!rules.length) return false;
  const key = hiddenItemKey(item);
  const text = [item.title, item.subtitle, item.creator?.title, item.collection?.title, item.collection?.parent?.title].filter(Boolean).join("\n").toLocaleLowerCase();
  return rules.some(rule => rule.kind === "item" ? rule.value === key : text.includes(rule.value.toLocaleLowerCase()));
}
