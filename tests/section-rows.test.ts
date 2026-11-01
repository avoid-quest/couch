import { expect, test } from "bun:test";
import { defaultHomeRows, readHomeRows } from "../src/client/sections/home/home-rows";
const saved = (value: unknown) => ({ getItem: () => JSON.stringify(value) });

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
});
