import { afterEach, expect, mock, test } from "bun:test";
import { calibration } from "./fixtures/live-listener";
import type { ListenerState } from "../src/client/session/live-listener/types";

mock.module("../src/client/session/live-listener/listener-worklet.ts?worker&url", () => ({ default: "/assets/listener-worklet.js" }));
const { createLiveListener } = await import("../src/client/session/live-listener/listener");
const originals = new Map<string, PropertyDescriptor | undefined>();
function replace(name: string, value: unknown) {
  if (!originals.has(name)) originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}
afterEach(() => {
  for (const [name, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name);
  }
  originals.clear();
});

function browser() {
  const workers: FakeWorker[] = [], contexts: FakeContext[] = [], nodes: FakeNode[] = [];
  let tap: (() => void) | null = null, releases = 0, locks = 0;
  const states: ListenerState[] = [];
  class FakeWorker {
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onerror: (() => void) | null = null;
    stopped = false;
    messages: unknown[] = [];
    constructor(readonly url: URL) { workers.push(this); }
    postMessage(data: unknown) { this.messages.push(data); }
    terminate() { this.stopped = true; }
  }
  class FakeContext {
    state = "suspended"; sampleRate = 48000; currentTime = 0; baseLatency = 0.003; outputLatency = 0.005;
    onstatechange: (() => void) | null = null;
    audioWorklet = { addModule: async () => {} };
    destination = {};
    gain = { gain: { value: 1 }, connect() {}, disconnect() {} };
    createGain() { return this.gain; }
    constructor() { contexts.push(this); }
    resume() { return Promise.resolve(); }
    close() { this.state = "closed"; return Promise.resolve(); }
    getOutputTimestamp() { return { contextTime: 0, performanceTime: 0 }; }
  }
  class FakeNode {
    port = { onmessage: null, postMessage() {}, close() {} };
    onprocessorerror: (() => void) | null = null;
    disconnected = false;
    constructor(_context: unknown, _name: string, options: unknown) { expect(options).toMatchObject({ processorOptions: { calibration: calibration() } }); nodes.push(this); }
    connect(target: unknown) { return target; }
    disconnect() { this.disconnected = true; }
  }
  const document = Object.assign(new EventTarget(), { visibilityState: "visible" });
  const audioSession = { type: "ambient" };
  replace("isSecureContext", true); replace("document", document);
  replace("navigator", { audioSession, wakeLock: { request: async () => {
    locks++; return Object.assign(new EventTarget(), { release: async () => { releases++; } });
  } } });
  replace("AudioContext", FakeContext); replace("AudioWorkletNode", FakeNode); replace("Worker", FakeWorker);
  const listener = createLiveListener({ url: "wss://fixture/api/live/listen", waitForTap: value => { tap = value; },
    onState: state => states.push(state), onStats() {} });
  return { listener, workers, contexts, nodes, states, audioSession, document, get tap() { return tap; }, get releases() { return releases; }, get locks() { return locks; } };
}

test("insecure pages report needs HTTPS without creating any audio or worker resource", async () => {
  const b = browser(); replace("isSecureContext", false);
  await b.listener.start();
  expect(b.states).toEqual([{ state: "needs-https" }]);
  expect(b.contexts).toHaveLength(0); expect(b.workers).toHaveLength(0);
  b.listener.stop();
});

test("calibration gates node creation, tap uses the supplied session hook, stop releases everything", async () => {
  const b = browser(), started = b.listener.start();
  try {
    expect(b.nodes).toHaveLength(0); expect(b.tap).toBeFunction();
    expect(b.states.at(-1)).toEqual({ state: "needs-tap" });
    expect(b.audioSession.type).toBe("playback");
    b.tap!(); b.contexts[0]!.state = "running"; b.contexts[0]!.onstatechange!();
    await Promise.resolve(); expect(b.tap).toBeNull(); expect(b.locks).toBe(1);
    b.workers.find(w => w.url.pathname.endsWith("calibration-worker.ts"))!.onmessage!({ data: calibration() });
    await started;
    expect(b.nodes).toHaveLength(1);
    b.document.visibilityState = "hidden"; b.document.dispatchEvent(new Event("visibilitychange"));
    await Promise.resolve(); expect(b.releases).toBe(1);
    b.document.visibilityState = "visible"; b.document.dispatchEvent(new Event("visibilitychange"));
    await Promise.resolve(); expect(b.locks).toBe(2);
  } finally { b.listener.stop(); await started; }
  expect(b.contexts[0]!.state).toBe("closed"); expect(b.nodes[0]!.disconnected).toBe(true);
  expect(b.workers.every(w => w.stopped)).toBe(true); expect(b.tap).toBeNull(); expect(b.releases).toBe(2);
});

test("stop during calibration cancels startup and cannot create a late node", async () => {
  const b = browser(), started = b.listener.start();
  b.listener.stop(); await started;
  expect(b.nodes).toHaveLength(0); expect(b.workers.every(w => w.stopped)).toBe(true);
  expect(b.states.at(-1)).toEqual({ state: "stopped" });
});
