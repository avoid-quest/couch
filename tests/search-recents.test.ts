import { afterEach, expect, test } from "bun:test";
import { readSearchRecents, rememberSearch } from "../src/client/sections/shell/search-recents";

const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
afterEach(() => {
  if (original) Object.defineProperty(globalThis, "localStorage", original);
  else Reflect.deleteProperty(globalThis, "localStorage");
});
const storage = (value: string | null) => {
  const data = new Map<string, string>(value === null ? [] : [["couch.search-recents:test", value]]);
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
  } });
};

test("malformed recents cannot break rendering or the next search", () => {
  for (const value of ["null", "{}", '"query"', "123", "{", null]) {
    storage(value);
    expect(readSearchRecents("test")).toEqual([]);
    expect(rememberSearch("test", "New query")).toEqual(["New query"]);
  }
});

test("recents validate members, cap their size and deduplicate the next query", () => {
  storage(JSON.stringify([null, 1, {}, "Music", ...Array.from({ length: 12 }, (_, i) => `Query ${i}`)]));
  expect(readSearchRecents("test")).toEqual(["Music", ...Array.from({ length: 7 }, (_, i) => `Query ${i}`)]);
  expect(rememberSearch("test", "music")).toEqual(["music", ...Array.from({ length: 7 }, (_, i) => `Query ${i}`)]);
  expect(readSearchRecents("other")).toEqual([]);
});

test("blocked storage leaves searching usable", () => {
  Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { throw new Error("Storage blocked"); } });
  expect(readSearchRecents("test")).toEqual([]);
  expect(rememberSearch("test", "New query")).toEqual(["New query"]);
});
