import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import type { MessageBoxOptions, Session, WebContents } from "electron";
import type { CouchApp } from "../src/shared/app-bridge";

const bundle = await Bun.build({ entrypoints: ["app/capture.ts"], target: "node", format: "cjs", external: ["electron"] });
if (!bundle.success) throw new Error("Capture module did not build.");
const code = await bundle.outputs[0]!.text();
type Check = NonNullable<Parameters<Session["setPermissionCheckHandler"]>[0]>;
type Request = NonNullable<Parameters<Session["setPermissionRequestHandler"]>[0]>;
type Display = NonNullable<Parameters<Session["setDisplayMediaRequestHandler"]>[0]>;
const screen = { id: "screen:1:0", name: "Studio display", kind: "screen" };

type Prompt = (options: MessageBoxOptions) => Promise<{ response: number }>;

function harness(platform = "darwin", version = "14.2", microphone: () => Promise<boolean> = async () => true, prompt: Prompt = async () => ({ response: 1 })) {
  let now = 1000;
  let check!: Check, request!: Request, display!: Display;
  let url = "http://localhost:4100";
  const contents = { mainFrame: { url } } as unknown as WebContents;
  const window = { id: 1 };
  const prompts: { parent: unknown; options: MessageBoxOptions }[] = [];
  const module = { exports: {} as typeof import("../app/capture") };
  runInNewContext(code, {
    module, exports: module.exports, URL, AbortController, Date: { now: () => now },
    process: { platform, getSystemVersion: () => version },
    require: () => ({
      BrowserWindow: { fromWebContents: (from: unknown) => from === contents ? window : null },
      dialog: { showMessageBox(parent: unknown, options: MessageBoxOptions) { prompts.push({ parent, options }); return prompt(options); } },
      desktopCapturer: { getSources: async () => [screen, { id: "window:2:0", name: "Music app" }] },
      systemPreferences: { askForMediaAccess: microphone },
      session: { defaultSession: {
        setPermissionCheckHandler(handler: Check) { check = handler; },
        setPermissionRequestHandler(handler: Request) { request = handler; },
        setDisplayMediaRequestHandler(handler: Display) { display = handler; },
      } },
    }),
  });
  const capture = module.exports.createCapture(() => contents, () => url, "http://localhost:4100");
  capture.install();
  return {
    capture, contents, window, prompts,
    expire() { now += 30_001; },
    navigate(next: string) { contents.mainFrame.url = next; },
    selectCouch(next: string) { url = next; },
    check(permission: Parameters<Check>[1], overrides: Partial<Parameters<Check>[3]> = {}, requester = contents, origin = url) {
      return check(requester, permission, origin, { isMainFrame: true, ...overrides });
    },
    request(permission: Parameters<Request>[1], mediaTypes: ("audio" | "video")[], isMainFrame = true) {
      let granted = false;
      request(contents, permission, result => { granted = result; }, { isMainFrame, requestingUrl: url, mediaTypes });
      return granted;
    },
    display(overrides: Partial<Parameters<Display>[0]> = {}) {
      let grant: Parameters<Parameters<Display>[1]>[0] | undefined;
      display({ frame: contents.mainFrame, securityOrigin: url, userGesture: true, videoRequested: true, audioRequested: true, ...overrides }, streams => { grant = streams; });
      return grant;
    },
  };
}

test("a selected display grants one local request with system audio", async () => {
  const h = harness();
  expect(await h.capture.sources()).toEqual([screen, { id: "window:2:0", name: "Music app", kind: "window" }]);
  expect(h.check("display-capture")).toBe(false);
  await h.capture.prepare({ kind: "system-audio", sourceId: screen.id });
  expect(h.check("display-capture")).toBe(true);
  expect(h.request("media", [])).toBe(true);
  expect(h.request("media", ["audio"])).toBe(false);
  expect(h.request("media", ["video"])).toBe(false);
  expect(h.request("media", [], false)).toBe(false);
  expect(h.display()).toEqual({ video: screen, audio: "loopback" });
  expect(h.check("media")).toBe(true);
  expect(h.check("media", { mediaType: "video" })).toBe(false);
  expect(h.check("media", { mediaType: "audio" })).toBe(false);
  expect(h.display()).toEqual({});
  expect(h.check("display-capture")).toBe(false);
  expect(h.request("media", [])).toBe(false);
});

test("capture preparation never grants another origin, frame, camera or app window", async () => {
  const h = harness();
  await h.capture.sources();
  await h.capture.prepare({ kind: "screen", sourceId: screen.id });
  expect(h.check("display-capture", { isMainFrame: false })).toBe(false);
  expect(h.check("display-capture", {}, h.contents, "https://foreign.example")).toBe(false);
  expect(h.check("display-capture", {}, { mainFrame: h.contents.mainFrame } as WebContents)).toBe(false);
  expect(h.display({ frame: { url: h.contents.mainFrame.url } as typeof h.contents.mainFrame })).toEqual({});
  expect(h.display()).toEqual({ video: screen, audio: "loopback" });
  await h.capture.prepare({ kind: "screen", sourceId: screen.id });
  expect(h.display({ userGesture: false })).toEqual({});
  await h.capture.prepare({ kind: "microphone" });
  expect(h.check("media", { mediaType: "audio" })).toBe(true);
  expect(h.check("media", { mediaType: "video" })).toBe(false);
  expect(h.request("media", ["audio"])).toBe(true);
  expect(h.request("media", ["video"])).toBe(false);
  expect(h.request("media", ["audio", "video"])).toBe(false);
  expect(h.request("media", ["audio"], false)).toBe(false);
  expect(h.check("fullscreen")).toBe(true);
  expect(h.request("fullscreen", [])).toBe(true);
  h.navigate("https://foreign.example");
  await expect(h.capture.prepare({ kind: "microphone" })).rejects.toThrow("this computer's Couch");
  await expect(h.capture.sources()).rejects.toThrow("this computer's Couch");
});

test("cancel, expiry and navigation revoke display selections", async () => {
  for (const revoke of [(h: ReturnType<typeof harness>) => h.capture.prepare(null), (h: ReturnType<typeof harness>) => h.expire(), (h: ReturnType<typeof harness>) => h.capture.clear()]) {
    const h = harness();
    await h.capture.sources();
    await h.capture.prepare({ kind: "screen", sourceId: screen.id });
    await revoke(h);
    expect(h.display()).toEqual({});
  }
  const h = harness();
  await h.capture.sources();
  await h.capture.prepare({ kind: "screen", sourceId: screen.id });
  h.selectCouch("https://other-couch.local");
  expect(h.display()).toEqual({});
  await expect(h.capture.prepare({ kind: "screen", sourceId: "missing" })).rejects.toThrow();
});

test("a saved Couch address grants its window's origin and nothing else", async () => {
  const h = harness();
  h.selectCouch("https://couch.local:4100/");
  h.navigate("https://couch.local:4100/find");
  await h.capture.sources();
  await h.capture.prepare({ kind: "screen", sourceId: screen.id });
  expect(h.check("display-capture", {}, h.contents, "https://couch.local:4100")).toBe(true);
  expect(h.check("display-capture", {}, h.contents, "https://foreign.example")).toBe(false);
  expect(h.check("display-capture", { isMainFrame: false }, h.contents, "https://couch.local:4100")).toBe(false);
  expect(h.display({ securityOrigin: "https://couch.local:4100" })).toEqual({ video: screen, audio: "loopback" });
  h.navigate("https://other-couch.local:4100/");
  await expect(h.capture.prepare({ kind: "microphone" })).rejects.toThrow("this computer's Couch");
  for (const saved of [null, "", "couch.local:4100", "not an address"]) {
    h.selectCouch(saved as string);
    h.navigate("https://couch.local:4100/");
    await expect(h.capture.sources()).rejects.toThrow("this computer's Couch");
    expect(h.check("display-capture", {}, h.contents, "https://couch.local:4100")).toBe(false);
    h.navigate("data:text/html,couch");
    await expect(h.capture.sources()).rejects.toThrow("this computer's Couch");
  }
});

test("another Couch's page gets the microphone only after this computer's owner allows it, each time", async () => {
  let answer = 0;
  const h = harness("darwin", "14.2", async () => true, async () => ({ response: answer }));
  // This computer's own Couch shares as before, without a prompt.
  await h.capture.prepare({ kind: "microphone" });
  expect(h.request("media", ["audio"])).toBe(true);
  expect(h.prompts).toEqual([]);
  h.selectCouch("https://couch.local:4100/");
  h.navigate("https://couch.local:4100/settings");
  await expect(h.capture.prepare({ kind: "microphone" })).rejects.toThrow("wasn't allowed");
  expect(h.prompts).toHaveLength(1);
  const [{ parent, options }] = h.prompts as [{ parent: unknown; options: MessageBoxOptions }];
  expect(parent).toBe(h.window);
  expect(options.message).toBe("Allow https://couch.local:4100 to use this computer's microphone?");
  expect(options.buttons).toEqual(["Don't Allow", "Allow"]);
  expect([options.defaultId, options.cancelId]).toEqual([0, 0]);
  expect(h.check("media", { mediaType: "audio" })).toBe(false);
  expect(h.request("media", ["audio"])).toBe(false);
  answer = 1;
  await h.capture.prepare({ kind: "microphone" });
  expect(h.check("media", { mediaType: "audio" })).toBe(true);
  expect(h.request("media", ["audio"])).toBe(true);
  expect(h.request("media", ["video"])).toBe(false);
  expect(h.request("media", ["audio"], false)).toBe(false);
  expect(h.check("media", { mediaType: "audio" }, h.contents, "https://foreign.example")).toBe(false);
  await h.capture.prepare(null);
  expect(h.request("media", ["audio"])).toBe(false);
  await h.capture.prepare({ kind: "microphone" });
  expect(h.prompts).toHaveLength(3);
  // Screens still need a source chosen in this window and a click to open it.
  await h.capture.sources();
  await h.capture.prepare({ kind: "screen", sourceId: screen.id });
  expect(h.prompts).toHaveLength(3);
});

test("a microphone prompt answered after cancel, close, navigation, a new request or another Couch grants nothing", async () => {
  type Harness = ReturnType<typeof harness>;
  const revocations: [string, (h: Harness) => unknown, boolean][] = [
    ["cancel or Close", h => h.capture.prepare(null), true],
    ["navigation", h => h.capture.clear(), true],
    ["a new request", h => { replacing = h.capture.prepare({ kind: "microphone" }).catch(() => {}); }, true],
    ["the page leaving that Couch", h => h.navigate("https://foreign.example/"), false],
    ["another Couch", h => h.selectCouch("https://other-couch.local:4100"), false],
  ];
  let replacing: Promise<void> | undefined;
  for (const [name, revoke, closesPrompt] of revocations) {
    const answers: ((answer: { response: number }) => void)[] = [];
    const h = harness("darwin", "14.2", async () => true, () => new Promise(resolve => { answers.push(resolve); }));
    h.selectCouch("https://couch.local:4100");
    h.navigate("https://couch.local:4100/");
    const preparing = h.capture.prepare({ kind: "microphone" });
    await revoke(h);
    expect([name, h.prompts[0]!.options.signal!.aborted]).toEqual([name, closesPrompt]);
    // The stale prompt is allowed anyway; the request that replaced it is not.
    answers.forEach((answer, index) => answer({ response: index ? 0 : 1 }));
    await expect(preparing).rejects.toThrow();
    await replacing;
    expect([name, h.check("media", { mediaType: "audio" }), h.request("media", ["audio"])]).toEqual([name, false, false]);
  }
});

test("macOS 14.0 keeps screen and microphone capture, while PC audio needs 14.2", async () => {
  const h = harness("darwin", "14.0");
  await h.capture.sources();
  await expect(h.capture.prepare({ kind: "system-audio", sourceId: screen.id })).rejects.toThrow("macOS 14.2");
  await h.capture.prepare({ kind: "screen", sourceId: screen.id });
  expect(h.display()).toEqual({ video: screen });
  await h.capture.prepare({ kind: "microphone" });
  expect(h.check("media", { mediaType: "audio" })).toBe(true);
  const denied = harness("darwin", "14.2", async () => false);
  await expect(denied.capture.prepare({ kind: "microphone" })).rejects.toThrow("System Settings");
  expect(denied.check("media", { mediaType: "audio" })).toBe(false);
  const linux = harness("linux");
  await expect(linux.capture.prepare({ kind: "system-audio", sourceId: screen.id })).rejects.toThrow("not available");
  const windows = harness("win32");
  await windows.capture.sources();
  await windows.capture.prepare({ kind: "system-audio", sourceId: screen.id });
  expect(windows.display()).toEqual({ video: screen, audio: "loopback" });
});

test("cancelling an outstanding macOS permission prompt cannot restore a capture lease", async () => {
  let consent!: (granted: boolean) => void;
  const h = harness("darwin", "14.2", () => new Promise(resolve => { consent = resolve; }));
  const preparing = h.capture.prepare({ kind: "microphone" });
  await h.capture.prepare(null);
  consent(true);
  await expect(preparing).rejects.toThrow("Start sharing again");
  expect(h.check("media", { mediaType: "audio" })).toBe(false);
});

test("the actual preload sends capture selections and cancellation to Main", async () => {
  const built = await Bun.build({ entrypoints: ["app/preload.ts"], target: "node", format: "cjs", external: ["electron"] });
  expect(built.success).toBe(true);
  let app!: CouchApp;
  const calls: unknown[] = [];
  runInNewContext(await built.outputs[0]!.text(), {
    process: { platform: "linux", argv: [] },
    require: () => ({
      contextBridge: { exposeInMainWorld(_name: string, bridge: CouchApp) { app = bridge; } },
      ipcRenderer: { async invoke(...args: unknown[]) { calls.push(args); return { value: args[0] === "couch:capture-sources" ? [screen] : undefined }; }, on() {}, off() {} },
    }),
  });
  expect(await app.captureSources!()).toEqual([screen]);
  await app.prepareCapture!({ kind: "screen", sourceId: screen.id });
  await app.prepareCapture!(null);
  expect(calls).toEqual([
    ["couch:capture-sources"], ["couch:prepare-capture", { kind: "screen", sourceId: screen.id }], ["couch:prepare-capture", null],
  ]);
});

test("the actual preload tells the page when Main closes its window, once per subscription", async () => {
  const built = await Bun.build({ entrypoints: ["app/preload.ts"], target: "node", format: "cjs", external: ["electron"] });
  expect(built.success).toBe(true);
  let app!: CouchApp;
  const listeners = new Map<string, Set<() => void>>();
  runInNewContext(await built.outputs[0]!.text(), {
    process: { platform: "linux", argv: [] },
    require: () => ({
      contextBridge: { exposeInMainWorld(_name: string, bridge: CouchApp) { app = bridge; } },
      ipcRenderer: {
        on(channel: string, listener: () => void) { listeners.set(channel, (listeners.get(channel) ?? new Set()).add(listener)); },
        off(channel: string, listener: () => void) { listeners.get(channel)?.delete(listener); },
      },
    }),
  });
  let closes = 0;
  const unsubscribe = app.onWindowClosed!(() => { closes++; });
  const close = () => { for (const listener of listeners.get("couch:window-closed") ?? []) listener(); };
  close(); close();
  expect(closes).toBe(2);
  unsubscribe();
  close();
  expect(closes).toBe(2);
  expect(listeners.get("couch:window-closed")?.size).toBe(0);
});
