import { expect, test } from "bun:test";

// A device from before Discover folded into Home: its sources' order and visibility were Discover's.
const discover = [
  { id: "sources", shown: true },
  { id: "radio", shown: false },
  { id: "twitch", shown: true },
];
Object.assign(globalThis, {
  localStorage: {
    getItem: (key: string) => (key === "couch.discover-rows" ? JSON.stringify(discover) : null),
  },
});
const { defaultHomeRows } = await import("../src/client/sections/home/home-rows");

test("A fresh Home opens with Browse, Continue and For later, then the sources as Discover had them", () => {
  expect(defaultHomeRows.slice(0, 5).map((row) => [row.id, row.shown])).toEqual([
    ["sources", true],
    ["continue", true],
    ["later", true],
    ["radio", false],
    ["twitch", true],
  ]);
  expect(defaultHomeRows.slice(-3)).toEqual([
    { id: "animeunity", shown: true },
    { id: "recent", shown: true },
    { id: "upNext", shown: false },
  ]);
});
