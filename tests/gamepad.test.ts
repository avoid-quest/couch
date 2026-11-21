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

/** A controller's reader; each frame says whether Couch has focus, and blur() takes it away between frames. */
function controller(wake = () => false) {
  const keys: NavigationKey[] = [];
  let focused = true;
  const reader = gamepadReader(
    (key) => keys.push(key),
    () => focused,
    wake,
  );
  const read = (pads: Gamepad[], focus: boolean, now: number) => {
    focused = focus;
    reader.read(pads, now);
  };
  const blur = () => {
    focused = false;
  };
  return { keys, read, key: reader.key, blur };
}

test("a controller moves Couch only while it has focus, and a press that gave it focus is not OK", () => {
  const { keys, read } = controller();
  // Without focus, nothing moves.
  read([pad([13])], false, 0);
  read([pad()], false, 16);
  read([pad([0])], false, 32);
  // A is still held as Couch gets focus, and its release is not OK.
  read([pad([0])], true, 48);
  read([pad()], true, 64);
  expect(keys).toEqual([]);
  // With focus: the stick, B and a short A.
  read([pad([], [0.1, 0.9])], true, 80);
  read([pad([1])], true, 96);
  read([pad([0])], true, 112);
  read([pad()], true, 128);
  // A pad without the standard mapping is ignored.
  read([pad([0, 12], [0, 0], "")], true, 144);
  read([pad()], true, 160);
  expect(keys).toEqual(["down", "back", "select"]);
});

test("a held direction repeats until Couch loses focus", () => {
  const { keys, read } = controller();
  read([pad([15])], true, 0);
  read([pad([15])], true, 300);
  read([pad([15])], true, 450);
  read([pad([15])], true, 560);
  read([pad([15])], false, 700);
  read([pad([15])], true, 1000);
  read([pad([15])], true, 2000);
  expect(keys).toEqual(["right", "right", "right"]);
});

test("a controller press that wakes the resting TV does nothing else until it is released", () => {
  let resting = true;
  const { keys, read } = controller(() => {
    const woke = resting;
    resting = false;
    return woke;
  });
  // A held right wakes it and never repeats; a held A wakes it, and neither its hold nor its release acts.
  read([pad([15])], true, 0);
  read([pad([15])], true, 500);
  read([pad([15])], true, 700);
  read([pad()], true, 800);
  resting = true;
  read([pad([0])], true, 900);
  read([pad([0])], true, 1500);
  read([pad()], true, 1600);
  expect(keys).toEqual([]);
  // The next press acts.
  read([pad([15])], true, 1700);
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

test("a controller press that also arrives as its key acts once, whichever comes first", () => {
  const { keys, read, key } = controller();
  // The key first: it acted, so the controller's press and its repeats are dropped until released.
  expect(key("ArrowDown", 0)).toBe(false);
  read([pad([13])], true, 16);
  read([pad([13])], true, 600);
  read([pad()], true, 700);
  expect(keys).toEqual([]);
  // The controller first: it acts, and the key that follows is dropped.
  read([pad([0])], true, 1000);
  expect(key("Enter", 1020)).toBe(true);
  read([pad()], true, 1050);
  expect(keys).toEqual(["select"]);
  // Apart, they are two presses.
  read([pad([1])], true, 2000);
  read([pad()], true, 2100);
  expect(key("Escape", 3000)).toBe(false);
  read([pad([1])], true, 4000);
  expect(keys).toEqual(["select", "back", "back"]);
});

test("a quick second tap with its echo acts again, and a keyboard's key counts when the control is up", () => {
  const { keys, read, key } = controller();
  // The controller first, twice 64 ms apart, each echoed.
  read([pad([13])], true, 0);
  expect(key("ArrowDown", 16)).toBe(true);
  read([pad()], true, 32);
  read([pad([13])], true, 64);
  expect(key("ArrowDown", 80)).toBe(true);
  read([pad()], true, 96);
  // The key first, twice 64 ms apart.
  expect(key("ArrowUp", 1000)).toBe(false);
  read([pad([12])], true, 1016);
  read([pad()], true, 1032);
  expect(key("ArrowUp", 1064)).toBe(false);
  read([pad([12])], true, 1080);
  read([pad()], true, 1096);
  expect(keys).toEqual(["down", "down"]);
  // A tap released before a keyboard's Enter: the key is its own press.
  read([pad([0])], true, 2000);
  read([pad()], true, 2016);
  expect(key("Enter", 2040)).toBe(false);
});

test("a held A whose menu comes due after Couch lost focus opens nothing", async () => {
  const { keys, read, blur } = controller();
  read([pad([0])], true, 0);
  blur();
  await new Promise((resolve) => setTimeout(resolve, 600));
  expect(keys).toEqual([]);
});
