import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { join } from "node:path";
import { runInNewContext } from "node:vm";

const bundle = await Bun.build({ entrypoints: ["app/live-audio.ts"], target: "node", format: "cjs", external: ["electron"],
  plugins: [{ name: "native-input-test-boundary", setup(build) { build.onResolve({ filter: /native-audio-input$/ }, () => ({ path: "native-input-test", external: true })); } }] });
if (!bundle.success) throw new Error("Live audio module did not build.");
const code = await bundle.outputs[0]!.text();
const format = { sampleRate: 48000, channels: 2, native: { requestedFrames: 128, reportedFrames: 256 } };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve };
}
function harness() {
  const owner = Object.assign(new EventEmitter(), { mainFrame: { url: "http://localhost:4100/", detached: false }, isDestroyed: () => false, send: () => {} });
  const entered = deferred<void>();
  const calls = { prepared: 0, consumed: 0, spawned: 0, stopped: 0, commands: 0 };
  let prepare = async () => format, stop = async () => {}, grant = async () => {};
  let signal: AbortSignal | undefined;
  let channels = 4;
  const module = { exports: {} as typeof import("../app/live-audio") };
  runInNewContext(code, {
    module, exports: module.exports, URL, Promise, AbortController, setTimeout, clearTimeout, __dirname: "/test",
    require: (name: string) => {
      if (name === "node:path") return { join };
      if (name === "electron") return { ipcMain: new EventEmitter(), BrowserWindow: class { constructor() { throw new Error("Native capture must not open a renderer"); } } };
      if (name === "native-input-test") return {
        nativeAudioInputs: async () => [{ uid: "umc", name: "UMC", channels, nominalRate: 48000, ownerHalBufferFrames: 512 }],
        nativeAudioInput: (...args: unknown[]) => {
          calls.spawned++; signal = args[5] as AbortSignal;
          return { prepare: () => { entered.resolve(); return prepare(); }, stop: () => { calls.stopped++; return stop(); }, command: async () => { calls.commands++; return undefined; } };
        },
      };
      throw new Error(`Unexpected import ${name}`);
    },
  });
  const capture = { prepare: async () => { calls.prepared++; await grant(); }, consumeMicrophone: () => { calls.consumed++; }, clear: () => {} };
  const live = module.exports.createLiveAudio(() => owner as never, capture as never, "http://localhost:4100", () => "test-token", "/test/capture");
  return { live, owner, entered, calls, channels: (value: number) => { channels = value; }, signal: () => signal, prepare: (fn: typeof prepare) => { prepare = fn; }, stop: (fn: typeof stop) => { stop = fn; }, grant: (fn: typeof grant) => { grant = fn; } };
}
const selection = { op: "prepare", id: "publication", deviceId: "native:umc", bufferFrames: 128 };

test("Main rejects unavailable or malformed channel maps before microphone permission or restart", async () => {
  const h = harness();
  for (const channelMap of [null, [], Array(1), [NaN], [Infinity], [4], [-1], [1.5], [0, 0], [1, 2], [0, 2], [2, 3, 4], "1/2"]) {
    await expect(h.live.action({ ...selection, channelMap })).rejects.toThrow("available channel");
  }
  expect(h.calls.prepared).toBe(0); expect(h.calls.spawned).toBe(0);
  await h.live.action({ ...selection, channelMap: [2, 3] });
  for (const channelMap of [[4], [3, 4], [0, 0]]) await expect(h.live.action({ op: "channels", id: selection.id, channelMap })).rejects.toThrow("available channel");
  expect(h.calls.commands).toBe(0);
  await h.live.action({ op: "channels", id: selection.id, channelMap: [1] });
  expect(h.calls.commands).toBe(1);
  await h.live.stop();
  h.channels(2);
  await expect(h.live.action({ ...selection, channelMap: [1] })).rejects.toThrow("available channel");
  await h.live.action(selection); await h.live.stop();
  await expect(h.live.action({ ...selection, deviceId: "browser-input", channelMap: [0, 1] })).rejects.toThrow("Choose a native input");
});

test("native preparation requires microphone authority and consumes it before spawn", async () => {
  const h = harness(); h.grant(async () => { throw new Error("Microphone denied"); });
  await expect(h.live.action(selection)).rejects.toThrow("Microphone denied");
  expect(h.calls.spawned).toBe(0); expect(h.calls.consumed).toBe(0);
  h.grant(async () => {});
  expect(await h.live.action(selection)).toEqual(format);
  expect(h.calls.consumed).toBe(1); expect(h.calls.spawned).toBe(1);
  await h.live.stop(); expect(h.signal()?.aborted).toBe(true); expect(h.calls.stopped).toBe(1);
});

test("Close during native preparation aborts the owned session before accepting its result", async () => {
  const h = harness(), ready = deferred<typeof format>(); h.prepare(() => ready.promise);
  const preparation = h.live.action(selection); await h.entered.promise;
  await h.live.stop(); ready.resolve(format);
  await expect(preparation).rejects.toThrow("canceled");
  expect(h.signal()?.aborted).toBe(true); expect(h.calls.stopped).toBe(1);
});

test("a pending replacement cannot start after Close while the prior native child retires", async () => {
  const h = harness(), closed = deferred<void>();
  await h.live.action(selection); h.stop(() => closed.promise);
  const retiring = h.live.stop();
  const replacement = h.live.action({ ...selection, id: "replacement" });
  void h.live.stop(); closed.resolve(); await retiring;
  await expect(replacement).rejects.toThrow("canceled"); expect(h.calls.spawned).toBe(1);
});

test("native selection and uploads retain local owner, publication and token boundaries", async () => {
  const h = harness(); h.owner.mainFrame.url = "https://other.example/";
  await expect(h.live.action(selection)).rejects.toThrow("this computer"); expect(h.calls.spawned).toBe(0);
  h.owner.mainFrame.url = "http://localhost:4100/";
  await expect(h.live.action({ ...selection, deviceId: "native:missing" })).rejects.toThrow("no longer available");
  await h.live.action(selection);
  await expect(h.live.action({ op: "upload", id: "publication", uploadId: "one", url: "ws://localhost:4100/api/live/upload?token=wrong&sourceId=publication&key=" + "a".repeat(64) + "&uploadId=one" })).rejects.toThrow("this publication");
  expect(h.calls.commands).toBe(0);
  h.owner.emit("did-start-navigation", {}, "http://localhost:4100/", false, true);
  expect(h.signal()?.aborted).toBe(true); await h.live.stop();
});

test("same-document browsing keeps active capture and its local commands", async () => {
  const h = harness();
  try {
    await h.live.action(selection);
    h.owner.emit("did-start-navigation", {}, "http://localhost:4100/saved", true, true);
    h.owner.mainFrame.url = "http://localhost:4100/saved";
    expect(h.signal()?.aborted).toBe(false);
    await h.live.action({ op: "mute", id: selection.id, muted: true });
    await h.live.action({ op: "upload", id: selection.id, uploadId: "one", url: "ws://localhost:4100/api/live/upload?token=test-token&sourceId=publication&key=" + "a".repeat(64) + "&uploadId=one" });
    expect(h.calls.commands).toBe(2);
    expect(h.calls.stopped).toBe(0);
  } finally { await h.live.stop(); }
});

test("same-document browsing during preparation retains the current document", async () => {
  const h = harness(), ready = deferred<typeof format>(); h.prepare(() => ready.promise);
  const preparation = h.live.action(selection); await h.entered.promise;
  h.owner.emit("did-start-navigation", {}, "http://localhost:4100/settings", true, true);
  h.owner.mainFrame.url = "http://localhost:4100/settings";
  ready.resolve(format);
  try { expect(await preparation).toEqual(format); expect(h.calls.stopped).toBe(0); }
  finally { await h.live.stop(); }
});

for (const change of ["frame", "origin", "detached"] as const) test(`capture rejects ${change} replacement after preparation`, async () => {
  const h = harness();
  try {
    await h.live.action(selection);
    if (change === "frame") h.owner.mainFrame = { ...h.owner.mainFrame };
    else if (change === "origin") h.owner.mainFrame.url = "https://other.example/saved";
    else h.owner.mainFrame.detached = true;
    await expect(h.live.action({ op: "mute", id: selection.id, muted: true })).rejects.toThrow("canceled");
    expect(h.calls.commands).toBe(0);
  } finally { await h.live.stop(); }
});

for (const event of ["destroyed", "render-process-gone"]) test(`${event} still retires capture`, async () => {
  const h = harness();
  await h.live.action(selection);
  h.owner.emit(event);
  expect(h.signal()?.aborted).toBe(true);
  await h.live.stop(); expect(h.calls.stopped).toBe(1);
});
