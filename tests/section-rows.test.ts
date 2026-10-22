import { expect, test } from "bun:test";
import { boardRows, defaultHomeRows, readHomeRows } from "../src/client/sections/home/home-rows";
const saved = (value: unknown) => ({ getItem: () => JSON.stringify(value) });

test("a fresh device shows your rows first, then every source (Discover folded into Home), with Up next hidden", () => {
  expect(readHomeRows(saved([]))).toEqual(defaultHomeRows);
  expect(defaultHomeRows.slice(0, boardRows.length).map(row => row.id)).toEqual([...boardRows]);
  expect(defaultHomeRows.filter(row => !row.shown).map(row => row.id)).toEqual(["upNext"]);
  expect(defaultHomeRows.at(-1)).toEqual({ id: "sources", shown: true });
});

test("reload keeps saved visibility and order, with newly introduced sections appended", () => {
  const rows = [{ id: "raiplay", shown: false }, { id: "sources", shown: true }, { id: "continue", shown: false }];
  const restored = readHomeRows(saved(rows));
  expect(restored.slice(0, 3)).toEqual(rows);
  expect(restored.slice(3)).toEqual(defaultHomeRows.filter(row => !rows.some(saved => saved.id === row.id)));
  expect(readHomeRows(saved(restored))).toEqual(restored);
});

test("all-hidden choices survive reload, including sources that are currently unavailable", () => {
  const rows = [...defaultHomeRows].reverse().map(row => ({ ...row, shown: false }));
  expect(readHomeRows(saved(rows))).toEqual(rows);
});

test("invalid preferences recover defaults and duplicate or obsolete sections cannot render twice", () => {
  for (const value of [null, {}, "bad"]) expect(readHomeRows(saved(value))).toEqual(defaultHomeRows);
  const rows = readHomeRows(saved([{ id: "radio", shown: false }, { id: "radio", shown: true }, { id: "old", shown: true }]));
  expect(rows[0]).toEqual({ id: "radio", shown: false });
  expect(rows).toHaveLength(defaultHomeRows.length);
  expect(readHomeRows(saved([{ id: "now", shown: true }]))).toEqual(defaultHomeRows);
});
