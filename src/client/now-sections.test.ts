import { expect, test } from "bun:test";
import { moveNowSection, readNowSections, saveNowSections } from "./now-sections";

const storage = (initial: Record<string, string | null> = {}) => {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, next: string) => { values.set(key, next); },
  };
};

test("sections default to the composed page and survive a round trip", () => {
  expect(readNowSections(storage())).toEqual({ order: ["playing", "queue", "history", "radio"], hidden: [] });
  const persisted = storage();
  saveNowSections({ order: ["radio", "playing", "queue", "history"], hidden: ["history"] }, persisted);
  expect(readNowSections(persisted)).toEqual({ order: ["radio", "playing", "queue", "history"], hidden: ["history"] });
});

test("stored orders from before Up next gained its own section are migrated", () => {
  const persisted = storage();
  saveNowSections({ order: ["radio", "playing", "history"], hidden: ["radio"] } as never, persisted);
  expect(readNowSections(persisted)).toEqual({ order: ["radio", "playing", "queue", "history"], hidden: ["radio"] });
});

test("corrupt or partial stored sections fall back to the default page", () => {
  expect(readNowSections(storage({ "couch.now-sections": "not json" }))).toEqual({ order: ["playing", "queue", "history", "radio"], hidden: [] });
  expect(readNowSections(storage({ "couch.now-sections": JSON.stringify({ order: ["radio"], hidden: [] }) }))).toEqual({ order: ["playing", "queue", "history", "radio"], hidden: [] });
  expect(readNowSections(storage({ "couch.now-sections": JSON.stringify({ order: ["radio", "radio", "history"], hidden: [] }) }))).toEqual({ order: ["radio", "playing", "queue", "history"], hidden: [] });
  expect(readNowSections(storage({ "couch.now-sections": JSON.stringify({ order: ["radio", "stage", "history"], hidden: [] }) }))).toEqual({ order: ["radio", "playing", "queue", "history"], hidden: [] });
  expect(readNowSections(storage({ "couch.now-sections": JSON.stringify({ order: ["playing", "queue", "history", "radio"], hidden: ["stage"] }) }))).toEqual({ order: ["playing", "queue", "history", "radio"], hidden: [] });
});

test("a stored order from before customization is kept", () => {
  expect(readNowSections(storage({ "couch.now-section-order": JSON.stringify(["radio", "playing", "history"]) }))).toEqual({ order: ["radio", "playing", "queue", "history"], hidden: [] });
});

test("the drop handler moves a section and ignores idling or foreign drops", () => {
  const order = readNowSections(storage()).order;
  expect(moveNowSection(order, "radio", "playing")).toEqual(["radio", "playing", "queue", "history"]);
  expect(moveNowSection(order, "playing", "playing")).toBeNull();
  expect(moveNowSection(order, "queue", "playing")).toEqual(["queue", "playing", "history", "radio"]);
});
