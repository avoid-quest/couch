import { expect, test } from "bun:test";

const store = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  },
  window: { dispatchEvent: () => true },
});
const { addHomeFollow, removeHomeFollow, setHomeSectionShown } =
  await import("../src/client/sections/home/home-rows");
const { followId, readHomeFollows } = await import("../src/client/sections/home/home-follows");

const url = "https://www.raiplay.it/programmi/blob";
const follow = {
  id: followId(url),
  provider: "raiplay",
  url,
  name: "Blob",
  list: "Puntate",
} as const;
const ids = () => JSON.parse(store.get("couch.home-rows")!) as { id: string; shown: boolean }[];

test("Undo of a removed section puts back only that section, keeping changes made since", () => {
  addHomeFollow(follow);
  const undo = removeHomeFollow(follow.id);
  setHomeSectionShown("recent", false);
  undo();
  expect(readHomeFollows().map((other) => other.id)).toEqual([follow.id]);
  expect(ids().find((row) => row.id === "recent")?.shown).toBe(false);
  expect(ids()[ids().findIndex((row) => row.id === "continue") + 1]).toEqual({
    id: follow.id,
    shown: true,
  });
});

test("Undo of an added section takes off only that section", () => {
  store.clear();
  const undo = addHomeFollow(follow);
  setHomeSectionShown("later", false);
  undo();
  expect(readHomeFollows()).toEqual([]);
  expect(ids().some((row) => row.id === follow.id)).toBe(false);
  expect(ids().find((row) => row.id === "later")?.shown).toBe(false);
});
