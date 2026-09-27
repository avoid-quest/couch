import { setupUiTests } from "@/testing/react";
import { expect, mock, spyOn, test } from "bun:test";
import * as core from "@tauri-apps/api/core";
import * as events from "@tauri-apps/api/event";
import { createNativeRenderer } from "./native-renderer";
import type { PlayerState } from "../../shared/protocol";

setupUiTests();
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
function harness(begin = Promise.resolve({ generation: "one", nonce: "initial" })) {
  let event!: (event: { payload: { generation: string; state: PlayerState } }) => void;
  let tick!: () => void;
  const unsubscribe = mock(() => {});
  spyOn(events, "listen").mockImplementation((async (_name: string, callback: typeof event) => { event = callback; return unsubscribe; }) as unknown as typeof events.listen);
  const ipc = spyOn(core, "invoke").mockImplementation((async (name: string) => name === "native_receiver_begin" ? await begin : name === "native_receiver_request" ? "next" : undefined) as typeof core.invoke);
  spyOn(globalThis, "setInterval").mockImplementation(((callback: () => void) => { tick = callback; return 1; }) as typeof setInterval);
  const clear = spyOn(globalThis, "clearInterval").mockImplementation(() => {});
  const observe = mock(() => {}), ready = mock(() => {}), lease = mock(() => {}), error = mock(() => {});
  const renderer = createNativeRenderer(observe, { origin: "https://core.example", ready, lease, error });
  return { renderer, ipc, observe, ready, lease, error, unsubscribe, clear, tick: () => tick(), event: (generation: string) => event({ payload: { generation, state: { status: "idle" } as PlayerState } }) };
}

test("begin only registers; Core acknowledgements renew, periodic requests never extend the lease", async () => {
  const h = harness();
  await flush();
  expect(h.ready).toHaveBeenCalledWith("initial");
  expect(h.ipc.mock.calls).toEqual([["native_receiver_begin", { origin: "https://core.example" }]]);
  h.renderer.renew("initial"); h.renderer.report();
  await flush();
  expect(h.ipc.mock.calls.slice(1)).toEqual([["native_receiver_renew", { generation: "one", nonce: "initial" }], ["native_receiver_report", { generation: "one" }]]);
  h.tick(); await flush();
  expect(h.lease).toHaveBeenCalledWith("next");
  expect(h.ipc.mock.calls.filter(([name]) => name === "native_receiver_renew")).toHaveLength(1);
  h.event("two"); expect(h.observe).not.toHaveBeenCalled();
  h.event("one"); expect(h.observe).toHaveBeenCalledTimes(1);
  h.renderer.close(); h.event("one"); h.tick(); h.renderer.renew("late"); h.renderer.command({ type: "stop" });
  await flush();
  expect(h.observe).toHaveBeenCalledTimes(1);
  expect(h.unsubscribe).toHaveBeenCalledTimes(1);
  expect(h.ipc).toHaveBeenLastCalledWith("native_receiver_end", { generation: "one" });
});

test("a begin resolving after close ends its generation without registering", async () => {
  const begin = deferred<{ generation: string; nonce: string }>();
  const h = harness(begin.promise); await flush();
  h.renderer.close(); begin.resolve({ generation: "four", nonce: "late" }); await flush();
  expect(h.ready).not.toHaveBeenCalled();
  expect(h.ipc).toHaveBeenLastCalledWith("native_receiver_end", { generation: "four" });
  expect(h.unsubscribe).toHaveBeenCalledTimes(1);
});

test("queued commands wait for acknowledgement IPC, and close cancels queued work", async () => {
  const h = harness(); await flush();
  const ack = deferred<void>();
  h.ipc.mockImplementation((async (name: string) => name === "native_receiver_renew" ? await ack.promise : undefined) as typeof core.invoke);
  h.renderer.renew("initial"); h.renderer.command({ type: "stop" }); await flush();
  expect(h.ipc.mock.calls.some(([name]) => name === "native_receiver_command")).toBe(false);
  h.renderer.close(); ack.resolve(); await flush();
  expect(h.ipc.mock.calls.some(([name]) => name === "native_receiver_command")).toBe(false);
  expect(h.ipc).toHaveBeenLastCalledWith("native_receiver_end", { generation: "one" });
});

test("IPC failure revokes playback and asks the connection to recover", async () => {
  const h = harness(); await flush();
  h.ipc.mockRejectedValue(new Error("Native player unavailable"));
  h.renderer.command({ type: "stop" }); await flush();
  expect(h.error).toHaveBeenCalledTimes(1);
  expect(h.unsubscribe).toHaveBeenCalledTimes(1);
  expect(h.ipc).toHaveBeenLastCalledWith("native_receiver_end", { generation: "one" });
});

test("a listener resolving after close is removed without beginning a receiver", async () => {
  const listener = deferred<() => void>();
  const unsubscribe = mock(() => {});
  spyOn(events, "listen").mockReturnValue(listener.promise);
  const ipc = spyOn(core, "invoke");
  const renderer = createNativeRenderer(() => {}, { origin: "https://core.example", ready: () => {}, lease: () => {}, error: () => {} });
  renderer.close(); listener.resolve(unsubscribe); await flush();
  expect(unsubscribe).toHaveBeenCalledTimes(1);
  expect(ipc).not.toHaveBeenCalled();
});

test("a renewal request completing after close cannot be forwarded or renew a replacement", async () => {
  const h = harness(); await flush();
  h.renderer.renew("initial"); await flush();
  const request = deferred<string>();
  h.ipc.mockImplementation((async (name: string) => name === "native_receiver_request" ? await request.promise : undefined) as typeof core.invoke);
  h.tick(); await flush(); h.renderer.close(); request.resolve("stale"); await flush();
  expect(h.lease).not.toHaveBeenCalled();
  expect(h.ipc).toHaveBeenLastCalledWith("native_receiver_end", { generation: "one" });
});
