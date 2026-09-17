import { expect, test } from "bun:test";
import { applyIdOrder, reorderedIds } from "./dnd";

const letters = ["a", "b", "c"];
const id = (letter: string) => letter;

test("reorderedIds moves one item and declines idling or unknown drops", () => {
  expect(reorderedIds(letters, id, "c", "a")).toEqual(["c", "a", "b"]);
  expect(reorderedIds(letters, id, "a", "c")).toEqual(["b", "c", "a"]);
  expect(reorderedIds(letters, id, "a", "a")).toBeNull();
  expect(reorderedIds(letters, id, "a", "z")).toBeNull();
  expect(reorderedIds(letters, id, "z", "a")).toBeNull();
});

test("applyIdOrder follows a complete custom order and reverts when it no longer matches", () => {
  expect(applyIdOrder(letters, ["c", "a", "b"], id)).toEqual(["c", "a", "b"]);
  expect(applyIdOrder(letters, undefined, id)).toEqual(letters);
  expect(applyIdOrder(letters, ["c", "b"], id)).toEqual(letters);
  // A stale id from a since-removed item is ignored; a missing id reverts.
  expect(applyIdOrder(letters, ["c", "a", "b", "z"], id)).toEqual(["c", "a", "b"]);
});
