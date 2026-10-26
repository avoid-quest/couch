import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
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
  let list: { id: string; name: string; thumbnail?: { isEmpty(): boolean; toDataURL(): string } }[] = [screen, { id: "window:2:0", name: "Music app" }];
  const sizes: { width: number; height: number }[] = [];
  const statuses: Record<string, string> = { screen: "granted", microphone: "granted" };
  const opened: string[] = [];
  const module = { exports: {} as typeof import("../app/capture") };
  runInNewContext(code, {
    module, exports: module.exports, URL, AbortController, Date: { now: () => now },
    process: { platform, getSystemVersion: () => version },
    require: () => ({
      BrowserWindow: { fromWebContents: (from: unknown) => from === contents ? window : null },
      dialog: { showMessageBox(parent: unknown, options: MessageBoxOptions) { prompts.push({ parent, options }); return prompt(options); } },
      desktopCapturer: { getSources: async (options: { thumbnailSize: { width: number; height: number } }) => { sizes.push(options.thumbnailSize); return list; } },
      systemPreferences: { askForMediaAccess: microphone, getMediaAccessStatus: (type: string) => statuses[type] },
      shell: { openExternal: async (target: string) => { opened.push(target); } },
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
    capture, contents, window, prompts, statuses, opened, sizes,
    list(next: typeof list) { list = next; },
    expire() { now += 30_001; },
    navigate(next: string) { contents.mainFrame.url = next; },
    selectCouch(next: string) { url = next; },
    check(permission: Parameters<Check>[1], overrides: Partial<Parameters<Check>[3]> = {}, requester = contents, origin = url) {
      return check(requester, permission, origin, { isMainFrame: true, ...overrides });
    },
    request(permission: Parameters<Request>[1], mediaTypes: ("audio" | "video")[], isMainFrame = true, requester = contents) {
      let granted = false;
      request(requester, permission, result => { granted = result; }, { isMainFrame, requestingUrl: url, mediaTypes });
      return granted;
    },
    // Resolves with Main's single answer, which may wait for the owner.
    display(overrides: Partial<Parameters<Display>[0]> = {}) {
      return new Promise<Parameters<Parameters<Display>[1]>[0] | null>((resolve, reject) => {
        let answers = 0;
        display({ frame: contents.mainFrame, securityOrigin: url, userGesture: true, videoRequested: true, audioRequested: true, ...overrides }, streams => {
          if (++answers > 1) reject(new Error("Main answered a display request twice."));
          resolve(streams);
        });
      });
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
  expect(await h.display()).toEqual({ video: screen, audio: "loopback" });
  expect(h.check("media")).toBe(true);
  expect(h.check("media", { mediaType: "video" })).toBe(false);
  expect(h.check("media", { mediaType: "audio" })).toBe(false);
  expect(await h.display()).toBeNull();
  expect(h.check("display-capture")).toBe(false);
  expect(h.request("media", [])).toBe(false);
  expect(h.prompts).toEqual([]);
});

test("screens and windows come as small pictures to this computer's own Couch, and as names alone to another's", async () => {
  const h = harness();
  const picture = { isEmpty: () => false, toDataURL: () => "data:image/png;base64,AA" };
  h.list([{ ...screen, thumbnail: picture }, { id: "window:2:0", name: "Music app", thumbnail: { isEmpty: () => true, toDataURL: () => "data:," } }]);
  expect(await h.capture.sources()).toEqual([{ ...screen, thumbnail: "data:image/png;base64,AA" }, { id: "window:2:0", name: "Music app", kind: "window" }]);
  expect(h.sizes.at(-1)).toEqual({ width: 320, height: 200 });
  h.selectCouch("https://couch.local:4100/");
  h.navigate("https://couch.local:4100/");
  expect(await h.capture.sources()).toEqual([screen, { id: "window:2:0", name: "Music app", kind: "window" }]);
  expect(h.sizes.at(-1)).toEqual({ width: 0, height: 0 });
  // Main still names a prepared source from its own list, without the picture.
  await h.capture.prepare({ kind: "screen", sourceId: screen.id });
  expect(await h.display({ securityOrigin: "https://couch.local:4100" })).toEqual({ video: screen });
  expect(h.prompts[0]?.options.message).toContain("“Studio display”");
});

test("capture preparation never grants another origin, frame, camera or app window", async () => {
  const h = harness();
  await h.capture.sources();
  await h.capture.prepare({ kind: "screen", sourceId: screen.id, audio: true });
  expect(h.check("display-capture", { isMainFrame: false })).toBe(false);
  expect(h.check("display-capture", {}, h.contents, "https://foreign.example")).toBe(false);
  expect(h.check("display-capture", {}, { mainFrame: h.contents.mainFrame } as WebContents)).toBe(false);
  expect(await h.display({ frame: { url: h.contents.mainFrame.url } as typeof h.contents.mainFrame })).toBeNull();
  expect(await h.display()).toEqual({ video: screen, audio: "loopback" });
  // A screen's sound is part of the selection, never just of the page's request.
  for (const audio of [false, undefined]) {
    await h.capture.prepare({ kind: "screen", sourceId: screen.id, audio });
    expect(await h.display()).toEqual({ video: screen });
  }
  await h.capture.prepare({ kind: "screen", sourceId: screen.id });
  expect(await h.display({ userGesture: false })).toBeNull();
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
    expect(await h.display()).toBeNull();
  }
  const h = harness();
  await h.capture.sources();
  await h.capture.prepare({ kind: "screen", sourceId: screen.id });
  h.selectCouch("https://other-couch.local");
  expect(await h.display()).toBeNull();
  await expect(h.capture.prepare({ kind: "screen", sourceId: "missing" })).rejects.toThrow();
});

test("a saved Couch address grants its window's origin and nothing else", async () => {
  const h = harness();
  h.selectCouch("https://couch.local:4100/");
  h.navigate("https://couch.local:4100/find");
  await h.capture.sources();
  await h.capture.prepare({ kind: "screen", sourceId: screen.id, audio: true });
  expect(h.check("display-capture", {}, h.contents, "https://couch.local:4100")).toBe(true);
  expect(h.check("display-capture", {}, h.contents, "https://foreign.example")).toBe(false);
  expect(h.check("display-capture", { isMainFrame: false }, h.contents, "https://couch.local:4100")).toBe(false);
  expect(await h.display({ securityOrigin: "https://couch.local:4100" })).toEqual({ video: screen, audio: "loopback" });
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
  // A screen is asked about when the page opens it, not when it is prepared.
  await h.capture.sources();
  await h.capture.prepare({ kind: "screen", sourceId: screen.id });
  expect(h.prompts).toHaveLength(3);
});

function remote(prompt?: Prompt, platform = "darwin") {
  const h = harness(platform, "14.2", async () => true, prompt);
  h.selectCouch("https://couch.local:4100");
  h.navigate("https://couch.local:4100/");
  return h;
}

test("another Couch's page gets a screen, window or this computer's audio only after this computer's owner allows the source and sound it names", async () => {
  let answer = 0;
  const h = remote(async () => ({ response: answer }));
  await h.capture.sources();
  // The page's own name for a source is ignored; Main names it from its own list.
  await h.capture.prepare({ kind: "screen", sourceId: screen.id, audio: true, name: "Couch's preview" } as never);
  expect(h.prompts).toEqual([]);
  expect(await h.display({ userGesture: false })).toBeNull();
  expect(h.prompts).toEqual([]);
  expect(await h.display()).toBeNull();
  const [{ parent, options }] = h.prompts as [{ parent: unknown; options: MessageBoxOptions }];
  expect(parent).toBe(h.window);
  expect(options.message).toBe("Allow https://couch.local:4100 to see the screen “Studio display” and hear this computer's audio?");
  expect(options.detail).toBe("This window shows that Couch's own page. Allow only if you just chose the screen “Studio display” to share there. The sound is everything this computer plays.");
  expect(options.buttons).toEqual(["Don't Allow", "Allow"]);
  expect([options.defaultId, options.cancelId]).toEqual([0, 0]);
  // A denied request leaves nothing to open or ask about again.
  expect([h.check("display-capture"), h.check("media"), h.request("media", [])]).toEqual([false, false, false]);
  expect(await h.display()).toBeNull();
  expect(h.prompts).toHaveLength(1);

  answer = 1;
  await h.capture.prepare({ kind: "screen", sourceId: screen.id, audio: true });
  expect(await h.display()).toEqual({ video: screen, audio: "loopback" });
  expect(h.check("media")).toBe(true);
  expect(await h.display()).toBeNull();
  expect(h.prompts).toHaveLength(2);

  // Without the sound in the selection, the prompt and the grant are the picture only.
  await h.capture.prepare({ kind: "screen", sourceId: "window:2:0" });
  expect(await h.display()).toEqual({ video: { id: "window:2:0", name: "Music app", kind: "window" } });
  expect(h.prompts.at(-1)!.options.message).toBe("Allow https://couch.local:4100 to see the window “Music app”?");
  expect(h.prompts.at(-1)!.options.detail).toBe("This window shows that Couch's own page. Allow only if you just chose the window “Music app” to share there.");
  await h.capture.prepare({ kind: "screen", sourceId: screen.id, audio: true });
  expect(await h.display({ audioRequested: false })).toEqual({ video: screen });
  expect(h.prompts.at(-1)!.options.message).toBe("Allow https://couch.local:4100 to see the screen “Studio display”?");

  // PC audio says the page also gets the picture.
  await h.capture.prepare({ kind: "system-audio", sourceId: screen.id });
  expect(await h.display()).toEqual({ video: screen, audio: "loopback" });
  expect(h.prompts.at(-1)!.options.message).toBe("Allow https://couch.local:4100 to hear this computer's audio?");
  expect(h.prompts.at(-1)!.options.detail).toBe("This window shows that Couch's own page. Only the sound is shared, but that page also gets the picture of the screen “Studio display”. Allow only if you just chose to share this computer's audio there.");
  const asked = h.prompts.length;
  await h.capture.prepare({ kind: "system-audio", sourceId: screen.id });
  expect(await h.display({ audioRequested: false })).toBeNull();
  expect(h.prompts).toHaveLength(asked);

  // A selection that doesn't say what it shares arms nothing.
  for (const selection of [{ kind: "screen", sourceId: screen.id, audio: "yes" }, { kind: "system-audio", sourceId: screen.id, audio: false }, { kind: "screen", sourceId: "screen:9:0", audio: true }]) {
    await expect(h.capture.prepare(selection)).rejects.toThrow();
    expect(h.check("display-capture")).toBe(false);
    expect(await h.display()).toBeNull();
  }
  expect(h.prompts).toHaveLength(asked);
});

test("a display prompt answered after cancel, Close, navigation, a new request or another Couch grants nothing", async () => {
  type Harness = ReturnType<typeof harness>;
  const revocations: [string, (h: Harness) => unknown, boolean][] = [
    ["cancel or Close", h => h.capture.prepare(null), true],
    ["navigation", h => h.capture.clear(), true],
    ["a new request", h => h.capture.prepare({ kind: "screen", sourceId: "window:2:0", audio: true }), true],
    ["the page leaving that Couch", h => h.navigate("https://foreign.example/"), false],
    ["another Couch", h => h.selectCouch("https://other-couch.local:4100"), false],
  ];
  for (const [name, revoke, closesPrompt] of revocations) {
    let answer!: (answer: { response: number }) => void;
    const h = remote(() => new Promise(resolve => { answer = resolve; }));
    await h.capture.sources();
    await h.capture.prepare({ kind: "screen", sourceId: screen.id, audio: true });
    const requesting = h.display();
    // While the owner decides, nothing is open and a second request is refused at once.
    expect([h.check("display-capture"), h.check("media"), h.request("media", [])]).toEqual([false, false, false]);
    expect(await h.display()).toBeNull();
    await revoke(h);
    expect([name, h.prompts[0]!.options.signal!.aborted]).toEqual([name, closesPrompt]);
    answer({ response: 1 });
    expect([name, await requesting]).toEqual([name, null]);
    expect([name, h.check("media"), h.check("display-capture", {}, h.contents, "https://couch.local:4100")]).toEqual([name, false, name === "a new request"]);
  }
});

test("the owner's answer may take its time, and grants exactly the source and sound it named", async () => {
  let answer!: (answer: { response: number }) => void;
  const h = remote(() => new Promise(resolve => { answer = resolve; }));
  await h.capture.sources();
  await h.capture.prepare({ kind: "screen", sourceId: screen.id, audio: true });
  const requesting = h.display();
  // The page refreshes its list meanwhile; the approved selection stays the one named.
  h.list([{ id: screen.id, name: "Renamed display" }, { id: "window:2:0", name: "Music app" }]);
  await h.capture.sources();
  h.expire();
  answer({ response: 1 });
  expect(await requesting).toEqual({ video: screen, audio: "loopback" });
  expect(h.prompts[0]!.options.message).toContain("“Studio display”");
  // Chromium opens the granted display just after the answer.
  expect(h.check("media")).toBe(true);
  expect(h.check("media", { mediaType: "audio" })).toBe(false);
});

test("a display prompt that fails, or a window that is gone, grants nothing", async () => {
  const h = remote(async () => { throw new Error("No window to attach the prompt to."); });
  await h.capture.sources();
  await h.capture.prepare({ kind: "system-audio", sourceId: screen.id });
  expect(await h.display()).toBeNull();
  expect([h.check("display-capture"), h.check("media")]).toEqual([false, false]);
  for (const response of [0, 2, -1]) {
    const unexpected = remote(async () => ({ response }));
    await unexpected.capture.sources();
    await unexpected.capture.prepare({ kind: "screen", sourceId: screen.id, audio: true });
    expect([response, await unexpected.display()]).toEqual([response, null]);
  }
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
  expect(await h.display()).toEqual({ video: screen });
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
  expect(await windows.display()).toEqual({ video: screen, audio: "loopback" });
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
    addEventListener() {},
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
    addEventListener() {},
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

test("a capture macOS denied names the setting to turn on and opens it", async () => {
  const h = harness();
  expect(h.capture.access("screen")).toBeNull();
  h.statuses.screen = "denied";
  h.statuses.microphone = "not-determined";
  expect(h.capture.access("system-audio")).toContain("Screen & System Audio Recording");
  expect(h.capture.access("microphone")).toContain("Microphone");
  await h.capture.openSettings("system-audio");
  await h.capture.openSettings("microphone");
  expect(h.opened).toEqual([
    "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
    "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
  ]);
  expect(() => h.capture.access("camera")).toThrow("Choose what to share.");
});

test("Windows has a setting only for the microphone, and Linux none", async () => {
  const windows = harness("win32");
  windows.statuses.microphone = "denied";
  expect(windows.capture.access("screen")).toBeNull();
  expect(windows.capture.access("microphone")).toContain("desktop apps");
  await windows.capture.openSettings("screen");
  await windows.capture.openSettings("microphone");
  expect(windows.opened).toEqual(["ms-settings:privacy-microphone"]);
  const linux = harness("linux");
  linux.statuses.screen = linux.statuses.microphone = "denied";
  expect(linux.capture.access("microphone")).toBeNull();
  await linux.capture.openSettings("screen");
  expect(linux.opened).toEqual([]);
});

test("only this app's Couch window reads or opens capture settings", async () => {
  const h = harness();
  h.navigate("https://elsewhere.example");
  expect(() => h.capture.access("screen")).toThrow("Start sharing from this computer's Couch window.");
  await expect(h.capture.openSettings("screen")).rejects.toThrow("Start sharing from this computer's Couch window.");
  expect(h.opened).toEqual([]);
});

test("native capture consumes only a fresh local microphone grant, once", async () => {
  const h = harness();
  expect(() => h.capture.consumeMicrophone()).toThrow("No current local microphone");
  await h.capture.prepare({ kind: "microphone" });
  h.capture.consumeMicrophone();
  expect(() => h.capture.consumeMicrophone()).toThrow("No current local microphone");
  expect(h.request("media", ["audio"])).toBe(false);
  await h.capture.prepare({ kind: "microphone" }); h.expire();
  expect(() => h.capture.consumeMicrophone()).toThrow("No current local microphone");
  h.selectCouch("https://remote.example"); h.navigate("https://remote.example");
  await h.capture.prepare({ kind: "microphone" });
  expect(() => h.capture.consumeMicrophone()).toThrow("No current local microphone");
});


test("the hidden browser capture frame receives only its owner's temporary microphone grant", async () => {
  const h = harness();
  const helper = () => Object.assign(new EventEmitter(), { mainFrame: { url: "http://localhost:4100/capture-audio.html", detached: false }, isDestroyed: () => false });
  const target = helper(), other = helper();
  const contents = target as unknown as WebContents;
  expect(() => h.capture.delegateMicrophone(contents)).toThrow("No current microphone");
  await h.capture.prepare({ kind: "microphone" });
  h.capture.delegateMicrophone(contents);
  expect(h.check("media", { mediaType: "audio" }, contents)).toBe(true);
  expect(h.request("media", ["audio"], true, contents)).toBe(true);
  expect(h.check("media", { mediaType: "audio" }, other as unknown as WebContents)).toBe(false);
  expect(h.check("media", { mediaType: "video" }, contents)).toBe(false);
  expect(h.request("media", ["audio", "video"], true, contents)).toBe(false);
  expect(h.check("media", { mediaType: "audio", isMainFrame: false }, contents)).toBe(false);
  expect(h.check("display-capture", {}, contents)).toBe(false);
  target.emit("did-start-navigation", {}, target.mainFrame.url, false, true);
  expect(h.check("media", { mediaType: "audio" }, contents)).toBe(false);
  expect(target.listenerCount("destroyed")).toBe(0);
  h.capture.delegateMicrophone(contents);
  h.navigate("https://elsewhere.example");
  expect(h.check("media", { mediaType: "audio" }, contents)).toBe(false);
  h.capture.clear();
  expect(target.listenerCount("did-start-navigation")).toBe(0);
});

test("cancellation, expiry and a replaced helper frame revoke delegated capture", async () => {
  for (const revoke of ["cancel", "expire", "frame", "destroy"] as const) {
    const h = harness();
    const target = Object.assign(new EventEmitter(), { mainFrame: { url: "http://localhost:4100/capture-audio.html", detached: false }, isDestroyed: () => false });
    const contents = target as unknown as WebContents;
    await h.capture.prepare({ kind: "microphone" }); h.capture.delegateMicrophone(contents);
    if (revoke === "cancel") await h.capture.prepare(null);
    if (revoke === "expire") h.expire();
    if (revoke === "frame") target.mainFrame = { ...target.mainFrame };
    if (revoke === "destroy") target.emit("destroyed");
    expect(h.check("media", { mediaType: "audio" }, contents)).toBe(false);
    expect(h.request("media", ["audio"], true, contents)).toBe(false);
    h.capture.clear();
  }
});
