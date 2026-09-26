import { expect, test } from "bun:test";
import { defaultHomeRows, readHomeRows } from "./home-rows";

const storage = (value: string | null) => ({ getItem: () => value });

test("Home rows keep a saved order, drop unknown rows and append new ones", () => {
  expect(readHomeRows(storage(null))).toEqual(defaultHomeRows);
  expect(readHomeRows(storage("not json"))).toEqual(defaultHomeRows);
  const rows = readHomeRows(storage(JSON.stringify([{ id: "radio", shown: false }, { id: "gone", shown: true }, { id: "now", shown: true }, { id: "radio", shown: true }])));
  expect(rows.slice(0, 2)).toEqual([{ id: "radio", shown: false }, { id: "now", shown: true }]);
  expect(rows.map(row => row.id)).toEqual(["radio", "now", "continue", "later", "recent", "upNext"]);
});
