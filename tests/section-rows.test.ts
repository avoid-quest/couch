import { expect, test } from "bun:test";
import { defaultDiscoverRows, readDiscoverRows } from "../src/client/sections/discover/discover-rows";
import { defaultHomeRows, readHomeRows } from "../src/client/sections/home/home-rows";
const saved = (value: unknown) => ({ getItem: () => JSON.stringify(value) });

test("a fresh device keeps Home's defaults and shows every Discover section", () => {
  expect(readHomeRows(saved([]))).toEqual(defaultHomeRows);
  expect(readDiscoverRows(saved([]))).toEqual(defaultDiscoverRows);
  expect(defaultDiscoverRows.every(row => row.shown)).toBe(true);
});

test("reload keeps saved visibility and order, with newly introduced sources appended", () => {
  const rows = [{ id: "raiplay", shown: false }, { id: "sources", shown: true }, { id: "live-tv", shown: false }];
  const restored = readDiscoverRows(saved(rows));
  expect(restored.slice(0, 3)).toEqual(rows);
  expect(restored.slice(3)).toEqual(defaultDiscoverRows.filter(row => !rows.some(saved => saved.id === row.id)));
  expect(readDiscoverRows(saved(restored))).toEqual(restored);
});

test("all-hidden choices survive reload, including sources that are currently unavailable", () => {
  const rows = [...defaultDiscoverRows].reverse().map(row => ({ ...row, shown: false }));
  expect(readDiscoverRows(saved(rows))).toEqual(rows);
});

test("invalid preferences recover defaults and duplicate or obsolete sections cannot render twice", () => {
  for (const value of [null, {}, "bad"]) expect(readDiscoverRows(saved(value))).toEqual(defaultDiscoverRows);
  const rows = readDiscoverRows(saved([{ id: "radio", shown: false }, { id: "radio", shown: true }, { id: "old", shown: true }]));
  expect(rows[0]).toEqual({ id: "radio", shown: false });
  expect(rows).toHaveLength(defaultDiscoverRows.length);
  expect(readHomeRows(saved([{ id: "now", shown: true }]))).toEqual(defaultHomeRows);
});
