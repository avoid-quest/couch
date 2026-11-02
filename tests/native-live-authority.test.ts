import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { join } from "node:path";
import { runInNewContext } from "node:vm";

const bundle = await Bun.build({
  entrypoints: ["app/live-audio.ts"],
  target: "node",
  format: "cjs",
  external: ["electron"],
  plugins: [
    {
      name: "native-input-test-boundary",
      setup(build) {
        build.onResolve({ filter: /native-audio-input$/ }, () => ({
          path: "native-input-test",
          external: true,
        }));
      },
    },
  ],
});
if (!bundle.success) throw new Error("Live audio module did not build.");
const code = await bundle.outputs[0]!.text();
const format = {
  sampleRate: 48000,
  channels: 2,
  native: { requestedFrames: 128, reportedFrames: 256 },
};
function harness() {
  const owner = Object.assign(new EventEmitter(), {
    mainFrame: { url: "http://localhost:4100/", detached: false },
    isDestroyed: () => false,
    send: () => {},
  });
  const calls = { consumed: 0, spawned: 0, stopped: 0, commands: 0 };
  let grant = async () => {};
  let signal: AbortSignal | undefined;
  const module = { exports: {} as typeof import("../app/live-audio") };
  runInNewContext(code, {
    module,
    exports: module.exports,
    URL,
    Promise,
    AbortController,
    setTimeout,
    clearTimeout,
    __dirname: "/test",
    require: (name: string) => {
      if (name === "node:path") return { join };
      if (name === "electron")
        return {
          ipcMain: new EventEmitter(),
          BrowserWindow: class {
            constructor() {
              throw new Error("Native capture must not open a renderer");
            }
          },
        };
      if (name === "native-input-test")
        return {
          nativeAudioInputs: async () => [
            { uid: "umc", name: "UMC", channels: 4, nominalRate: 48000, ownerHalBufferFrames: 512 },
          ],
          nativeAudioInput: (...args: unknown[]) => {
            calls.spawned++;
            signal = args[5] as AbortSignal;
            return {
              prepare: async () => format,
              stop: async () => {
                calls.stopped++;
              },
              command: async () => {
                calls.commands++;
                return undefined;
              },
            };
          },
        };
      throw new Error(`Unexpected import ${name}`);
    },
  });
  const capture = {
    prepare: async () => {
      await grant();
    },
    consumeMicrophone: () => {
      calls.consumed++;
    },
    clear: () => {},
  };
  const live = module.exports.createLiveAudio(
    () => owner as never,
    capture as never,
    "http://localhost:4100",
    () => "test-token",
    "/test/capture",
  );
  return {
    live,
    owner,
    calls,
    signal: () => signal,
    grant: (fn: typeof grant) => {
      grant = fn;
    },
  };
}
const selection = { op: "prepare", id: "publication", deviceId: "native:umc", bufferFrames: 128 };

test("native preparation requires microphone authority and consumes it before spawn", async () => {
  const h = harness();
  h.grant(async () => {
    throw new Error("Microphone denied");
  });
  await expect(h.live.action(selection)).rejects.toThrow("Microphone denied");
  expect(h.calls.spawned).toBe(0);
  expect(h.calls.consumed).toBe(0);
  h.grant(async () => {});
  expect(await h.live.action(selection)).toEqual(format);
  expect(h.calls.consumed).toBe(1);
  expect(h.calls.spawned).toBe(1);
  await h.live.stop();
  expect(h.signal()?.aborted).toBe(true);
  expect(h.calls.stopped).toBe(1);
});

test("native selection and uploads retain local owner, publication and token boundaries", async () => {
  const h = harness();
  h.owner.mainFrame.url = "https://other.example/";
  await expect(h.live.action(selection)).rejects.toThrow("this computer");
  expect(h.calls.spawned).toBe(0);
  h.owner.mainFrame.url = "http://localhost:4100/";
  await expect(h.live.action({ ...selection, deviceId: "native:missing" })).rejects.toThrow(
    "no longer available",
  );
  await h.live.action(selection);
  await expect(
    h.live.action({
      op: "upload",
      id: "publication",
      uploadId: "one",
      url:
        "ws://localhost:4100/api/live/upload?token=wrong&sourceId=publication&key=" +
        "a".repeat(64) +
        "&uploadId=one",
    }),
  ).rejects.toThrow("this publication");
  expect(h.calls.commands).toBe(0);
  h.owner.emit("did-start-navigation", {}, "http://localhost:4100/", false, true);
  expect(h.signal()?.aborted).toBe(true);
  await h.live.stop();
});

for (const change of ["frame", "origin", "detached"] as const)
  test(`capture rejects ${change} replacement after preparation`, async () => {
    const h = harness();
    try {
      await h.live.action(selection);
      if (change === "frame") h.owner.mainFrame = { ...h.owner.mainFrame };
      else if (change === "origin") h.owner.mainFrame.url = "https://other.example/saved";
      else h.owner.mainFrame.detached = true;
      await expect(h.live.action({ op: "mute", id: selection.id, muted: true })).rejects.toThrow(
        "canceled",
      );
      expect(h.calls.commands).toBe(0);
    } finally {
      await h.live.stop();
    }
  });
