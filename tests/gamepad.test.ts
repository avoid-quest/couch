import { expect, test } from "bun:test";
import type { NavigationKey } from "../src/shared/protocol";
import { gamepadReader } from "../src/client/gamepad";
import { keyPresses } from "../src/client/key-presses";

const pad = (pressed: number[] = [], axes = [0, 0], mapping = "standard") =>
  ({
    mapping,
    axes,
    buttons: Array.from({ length: 17 }, (_, index) => ({ pressed: pressed.includes(index) })),
  }) as unknown as Gamepad;

test("a controller moves Couch only while it has focus, and a press that gave it focus is not OK", () => {
  const keys: NavigationKey[] = [];
  const reader = gamepadReader(
    (key) => keys.push(key),
    () => false,
  );
  // Without focus, nothing moves.
  reader.read([pad([13])], false, 0);
  reader.read([pad()], false, 16);
  reader.read([pad([0])], false, 32);
  // A is still held as Couch gets focus, and its release is not OK.
  reader.read([pad([0])], true, 48);
  reader.read([pad()], true, 64);
  expect(keys).toEqual([]);
  // With focus: the stick, B and a short A.
  reader.read([pad([], [0.1, 0.9])], true, 80);
  reader.read([pad([1])], true, 96);
  reader.read([pad([0])], true, 112);
  reader.read([pad()], true, 128);
  // A pad without the standard mapping is ignored.
  reader.read([pad([0, 12], [0, 0], "")], true, 144);
  reader.read([pad()], true, 160);
  expect(keys).toEqual(["down", "back", "select"]);
});

test("a held direction repeats until Couch loses focus", () => {
  const keys: NavigationKey[] = [];
  const reader = gamepadReader(
    (key) => keys.push(key),
    () => false,
  );
  reader.read([pad([15])], true, 0);
  reader.read([pad([15])], true, 300);
  reader.read([pad([15])], true, 450);
  reader.read([pad([15])], true, 560);
  reader.read([pad([15])], false, 700);
  reader.read([pad([15])], true, 1000);
  reader.read([pad([15])], true, 2000);
  expect(keys).toEqual(["right", "right", "right"]);
});

test("a controller press that wakes the resting TV does nothing else until it is released", () => {
  const keys: NavigationKey[] = [];
  let resting = true;
  const reader = gamepadReader(
    (key) => keys.push(key),
    () => {
      const woke = resting;
      resting = false;
      return woke;
    },
  );
  // A held right wakes it and never repeats; a held A wakes it, and neither its hold nor its release acts.
  reader.read([pad([15])], true, 0);
  reader.read([pad([15])], true, 500);
  reader.read([pad([15])], true, 700);
  reader.read([pad()], true, 800);
  resting = true;
  reader.read([pad([0])], true, 900);
  reader.read([pad([0])], true, 1500);
  reader.read([pad()], true, 1600);
  expect(keys).toEqual([]);
  // The next press acts.
  reader.read([pad([15])], true, 1700);
  expect(keys).toEqual(["right"]);
});

test("a key press that wakes the resting TV is taken whole: keydown, repeats and keyup", () => {
  const presses = keyPresses();
  let resting = true;
  presses.claim(() => {
    const woke = resting;
    resting = false;
    return woke;
  });
  const key = (type: string, name: string, repeat = false) =>
    presses.takes({ type, key: name, repeat, timeStamp: 0 });
  expect(key("keydown", "Enter")).toBe(true);
  expect(key("keydown", "Enter", true)).toBe(true);
  expect(key("keyup", "Enter")).toBe(true);
  // Awake, the next press goes through.
  expect(key("keydown", "Enter")).toBe(false);
  expect(key("keyup", "Enter")).toBe(false);
  // A held arrow that wakes it: none of its repeats moves focus.
  resting = true;
  expect(key("keydown", "ArrowRight")).toBe(true);
  expect(key("keydown", "ArrowRight", true)).toBe(true);
  // Another key pressed meanwhile is its own press.
  expect(key("keydown", "ArrowDown")).toBe(false);
  expect(key("keyup", "ArrowRight")).toBe(true);
});
