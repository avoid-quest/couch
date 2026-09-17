import { expect, test } from "bun:test";
import { moveNowSection, readNowSectionOrder, saveNowSectionOrder } from "./now-sections";

const storage = (initial: string | null) => {
  let value = initial;
  return { getItem: () => value, setItem: (_key: string, next: string) => { value = next; } };
};

test("section order defaults to the composed page and survives a round trip", () => {
  expect(readNowSectionOrder(storage(null))).toEqual(["playing", "history", "radio"]);
  const persisted = storage(null);
  saveNowSectionOrder(["radio", "playing", "history"], persisted);
  expect(readNowSectionOrder(persisted)).toEqual(["radio", "playing", "history"]);
});

test("corrupt or partial stored orders fall back to the default page", () => {
  expect(readNowSectionOrder(storage("not json"))).toEqual(["playing", "history", "radio"]);
  expect(readNowSectionOrder(storage(JSON.stringify(["radio"])))).toEqual(["playing", "history", "radio"]);
  expect(readNowSectionOrder(storage(JSON.stringify(["radio", "radio", "history"])))).toEqual(["playing", "history", "radio"]);
  expect(readNowSectionOrder(storage(JSON.stringify(["radio", "stage", "history"])))).toEqual(["playing", "history", "radio"]);
});

test("the drop handler moves a section and ignores idling or foreign drops", () => {
  const order = readNowSectionOrder(storage(null));
  expect(moveNowSection(order, "radio", "playing")).toEqual(["radio", "playing", "history"]);
  expect(moveNowSection(order, "playing", "playing")).toBeNull();
  expect(moveNowSection(order, "queue", "playing")).toBeNull();
});
