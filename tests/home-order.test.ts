import { expect, test } from "bun:test";
import { keptOrder } from "../src/client/sections/home/home-rows";

const ids = (items: { id: string }[]) => items.map(item => item.id);
const order = ["nts-1", "nts-2", "lyl", "sygma"];

test("a station that starts playing keeps its place in the row Home opened with", () => {
  // Recents put the station that just played first; Home keeps the order it opened with.
  const playing = [{ id: "nts-2" }, { id: "nts-1" }, { id: "lyl" }, { id: "sygma" }];
  expect(ids(keptOrder(order, playing, item => item.id))).toEqual(order);
});

test("items Home hasn't shown yet follow the ones it has, in their own order", () => {
  const changed = [{ id: "new-b" }, { id: "lyl" }, { id: "new-a" }, { id: "nts-1" }, { id: "sygma" }];
  expect(ids(keptOrder(order, changed, item => item.id))).toEqual(["nts-1", "lyl", "sygma", "new-b", "new-a"]);
});
