import { expect, test } from "bun:test";

// A device from before Discover folded into Home: its sources' order and visibility were Discover's.
const discover = [{ id: "sources", shown: true }, { id: "radio", shown: false }, { id: "twitch", shown: true }];
Object.assign(globalThis, { localStorage: { getItem: (key: string) => key === "couch.discover-rows" ? JSON.stringify(discover) : null } });
const { defaultHomeRows } = await import("../src/client/sections/home/home-rows");

test("Home's sources start in the order and visibility Discover's had", () => {
  expect(defaultHomeRows.slice(0, 7).map(row => [row.id, row.shown])).toEqual([
    ["continue", true], ["later", true], ["recent", true], ["upNext", false], ["sources", true], ["radio", false], ["twitch", true],
  ]);
  expect(defaultHomeRows.at(-1)).toEqual({ id: "animeunity", shown: true });
});
