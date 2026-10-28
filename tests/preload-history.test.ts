import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";

const build = await Bun.build({ entrypoints: ["app/preload.ts"], target: "node", format: "cjs", external: ["electron"] });
const preload = await build.outputs[0]!.text();

function fixture(platform = "darwin", tv = false) {
  const classes = new Set<string>();
  const geometry = new Map<string, () => void>();
  const overlay = { visible: true, addEventListener: (name: string, fn: () => void) => geometry.set(name, fn) };
  const listeners = new Map<string, (...args: any[]) => void>();
  const addListener = (name: string, fn: (...args: any[]) => void) => { const previous = listeners.get(name); listeners.set(name, (...args: any[]) => { previous?.(...args); fn(...args); }); };
  const ipc = new Map<string, (...args: any[]) => void>();
  const visits: number[] = [];
  const attributes = new Map<string, string>();
  const fullscreen = { fullscreenElement: null as object | null };
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
    addEventListener: addListener,
    navigator: { windowControlsOverlay: overlay },
    Element, getComputedStyle: (element: Element) => element,
    history: { go: (direction: number) => visits.push(direction) },
    document: {
      get fullscreenElement() { return fullscreen.fullscreenElement; },
      createElement: () => ({ textContent: "" }),
      head: { append() {} },
      documentElement: { classList: { add: (...names: string[]) => names.forEach(name => classes.add(name)), toggle: (name: string, on: boolean) => on ? classes.add(name) : classes.delete(name) }, setAttribute: (name: string, value: string) => attributes.set(name, value), removeAttribute: (name: string) => attributes.delete(name) },
      body: { classList: { contains: () => tv } },
    },
  });
  const target = new Element();
  const wheel = (deltaX: number, deltaY = 0, extra = {}) => listeners.get("wheel")?.({
    deltaX, deltaY, deltaMode: 0, timeStamp: 1, defaultPrevented: false,
    composedPath: () => [target], ...extra,
  });
  const end = () => ipc.get("couch:scroll-end")?.({});
  return { listeners, ipc, attributes, classes, overlay, geometry, fullscreen, target, visits, wheel, end };
}

test("desktop controls reserve the platform's space and release it in fullscreen", () => {
  for (const platform of ["darwin", "win32", "linux"]) {
    const f = fixture(platform);
    f.listeners.get("DOMContentLoaded")!();
    // Keep the Mac's empty attribute compatible with older remote renderers.
    expect(f.attributes.get("data-window-controls")).toBe(platform === "darwin" ? "" : undefined);
    f.ipc.get("couch:full-screen")!({}, true);
    expect(f.attributes.has("data-window-controls")).toBe(false);
    expect(f.classes.has("wco")).toBe(false);
    f.ipc.get("couch:full-screen")!({}, false);
    expect(f.attributes.has("data-window-controls")).toBe(platform === "darwin");
    expect(f.classes.has("wco")).toBe(platform !== "darwin");
  }
});

test("WCO follows native geometry, including fullscreen and restored controls", () => {
  for (const platform of ["win32", "linux"]) {
    const f = fixture(platform);
    f.listeners.get("DOMContentLoaded")!();
    expect(f.classes.has(platform === "win32" ? "electron-windows" : "electron-linux")).toBe(true);
    expect(f.classes.has("wco")).toBe(true);
    f.overlay.visible = false;
    f.geometry.get("geometrychange")!();
    expect(f.classes.has("wco")).toBe(false);
    expect(f.attributes.has("data-window-controls")).toBe(false);
    f.overlay.visible = true;
    f.geometry.get("geometrychange")!();
    expect(f.classes.has("wco")).toBe(true);
    expect(f.attributes.has("data-window-controls")).toBe(false);
  }
  const mac = fixture();
  mac.listeners.get("DOMContentLoaded")!();
  expect(mac.classes.size).toBe(0);
});

test("TV windows never reserve desktop controls on any platform", () => {
  for (const platform of ["darwin", "win32", "linux"]) {
    const f = fixture(platform, true);
    expect(f.listeners.has("DOMContentLoaded")).toBe(false);
    expect(f.ipc.has("couch:full-screen")).toBe(false);
  }
});

test("fullscreen suppresses stale visible overlay geometry until both fullscreen modes end", () => {
  for (const platform of ["win32", "linux"]) {
    const f = fixture(platform);
    f.listeners.get("DOMContentLoaded")!();
    f.ipc.get("couch:full-screen")!({}, true);
    f.geometry.get("geometrychange")!();
    expect(f.classes.has("wco")).toBe(false);
    f.fullscreen.fullscreenElement = {};
    f.listeners.get("fullscreenchange")!();
    f.ipc.get("couch:full-screen")!({}, false);
    f.geometry.get("geometrychange")!();
    expect(f.classes.has("wco")).toBe(false);
    f.fullscreen.fullscreenElement = null;
    f.listeners.get("fullscreenchange")!();
    expect(f.classes.has("wco")).toBe(true);
    // DOM fullscreen can also precede Main's notification.
    f.fullscreen.fullscreenElement = {};
    f.listeners.get("fullscreenchange")!();
    f.geometry.get("geometrychange")!();
    expect(f.classes.has("wco")).toBe(false);
  }
});

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
