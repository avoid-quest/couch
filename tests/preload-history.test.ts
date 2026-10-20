import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";

const build = await Bun.build({ entrypoints: ["app/preload.ts"], target: "node", format: "cjs", external: ["electron"] });
const preload = await build.outputs[0]!.text();

function fixture(platform = "darwin", tv = false) {
  const listeners = new Map<string, (...args: any[]) => void>();
  const ipc = new Map<string, (...args: any[]) => void>();
  const visits: number[] = [];
  class Element {
    scrollWidth = 100;
    clientWidth = 100;
    overflowX = "visible";
    protectedControl = false;
    selector = "";
    matches(selectors: string) { return this.protectedControl || !!this.selector && selectors.split(", ").includes(this.selector); }
  }
  runInNewContext(preload, {
    require: () => ({ contextBridge: { exposeInMainWorld() {} }, ipcRenderer: { on: (name: string, fn: (...args: any[]) => void) => ipc.set(name, fn) } }),
    process: { platform, argv: tv ? ["--couch-tv-presentation"] : [] },
    addEventListener: (name: string, fn: (...args: any[]) => void) => listeners.set(name, fn),
    Element, getComputedStyle: (element: Element) => element,
    history: { go: (direction: number) => visits.push(direction) },
    document: { body: { classList: { contains: () => tv } } },
  });
  const target = new Element();
  const wheel = (deltaX: number, deltaY = 0, extra = {}) => listeners.get("wheel")?.({
    deltaX, deltaY, deltaMode: 0, timeStamp: 1, defaultPrevented: false,
    composedPath: () => [target], ...extra,
  });
  const end = () => ipc.get("couch:scroll-end")?.({});
  return { listeners, target, visits, wheel, end };
}

test("a macOS horizontal gesture traverses native history once, at its native end", () => {
  const f = fixture();
  f.wheel(-60); f.wheel(-60);
  expect(f.visits).toEqual([]);
  f.end(); f.end();
  expect(f.visits).toEqual([-1]);
  f.wheel(120); f.end();
  expect(f.visits).toEqual([-1, 1]);
});

test("vertical, diagonal, short and modified gestures leave history alone", () => {
  const f = fixture();
  for (const [x, y, extra] of [[0, 150, {}], [150, 100, {}], [30, 0, {}], [150, 0, { ctrlKey: true }], [150, 0, { shiftKey: true }], [150, 0, { metaKey: true }], [150, 0, { altKey: true }], [150, 0, { deltaMode: 1 }], [150, 0, { defaultPrevented: true }]] as const) {
    f.wheel(x, y, extra); f.end();
  }
  expect(f.visits).toEqual([]);
});

test("horizontal content owns the whole gesture, even at its edge", () => {
  const f = fixture();
  f.target.scrollWidth = 400; f.target.overflowX = "auto";
  f.wheel(-120);
  f.target.scrollWidth = 100;
  f.wheel(-120); f.end();
  expect(f.visits).toEqual([]);
  f.wheel(-120); f.end();
  expect(f.visits).toEqual([-1]);
});

test("form and media controls keep the whole gesture", () => {
  const f = fixture();
  f.target.protectedControl = true;
  f.wheel(120);
  f.target.protectedControl = false;
  f.wheel(120); f.end();
  expect(f.visits).toEqual([]);
});

test("slider tracks, ranges and thumbs keep horizontal gestures", () => {
  for (const part of ["track", "range", "thumb"]) {
    const f = fixture();
    f.target.selector = part === "thumb" ? '[role="slider"]' : '[data-slot="slider"]';
    // A track/range's composed path includes its slider root; the thumb has its own role.
    f.wheel(-150); f.end();
    expect(f.visits).toEqual([]);
  }
});

test("a cancelled gesture stays cancelled through its remaining momentum", () => {
  const f = fixture();
  f.wheel(20, 0, { ctrlKey: true });
  f.wheel(150); f.end();
  expect(f.visits).toEqual([]);
  f.wheel(-150); f.end();
  expect(f.visits).toEqual([-1]);
});

test("an old wheel sequence cannot contribute to a later gesture", () => {
  const f = fixture();
  f.wheel(70, 0, { timeStamp: 1 });
  f.wheel(70, 0, { timeStamp: 500 }); f.end();
  expect(f.visits).toEqual([]);
});

test("the adapter is absent on Windows, Linux and TV", () => {
  for (const [platform, tv] of [["win32", false], ["linux", false], ["darwin", true]] as const) {
    expect(fixture(platform, tv).listeners.has("wheel")).toBe(false);
  }
});
