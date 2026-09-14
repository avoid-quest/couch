import { expect, spyOn, test } from "bun:test";
import { createNativeAppImageUpdates } from "./appimage-update-native";
import type { AppImageUpdateAction } from "../shared/updates";
const candidate = { summary: { id: "a".repeat(64), releaseId: "2.1", version: "0.1.0+build.2.1", revision: "b".repeat(40), notes: "new", bytes: 50, publishedAt: 1, expiresAt: Date.now() + 60_000 }, staged: true };
test("phone status remains available while the feed is checking", async () => {
  const sent: { id: string; action: AppImageUpdateAction }[] = [];
  const native = createNativeAppImageUpdates((id, action) => sent.push({ id, action }));
  const checking = native.feed.check("preview", new AbortController().signal);
  const status = native.request({ op: "status" });
  if (sent[1]) native.receive({ requestId: sent[1].id, ok: true, transaction: null });
  native.receive({ requestId: sent[0]!.id, candidate });
  await checking;
  await expect(status).resolves.toMatchObject({ ok: true, transaction: null });
  native.close();
});
test("private pipe uses fixed actions, correlates replies and forwards progress", async () => {
  const sent: { id: string; action: AppImageUpdateAction }[] = [];
  const native = createNativeAppImageUpdates((id, action) => sent.push({ id, action }));
  const checking = native.feed.check("preview", new AbortController().signal);
  expect(sent[0]!.action).toEqual({ type: "check", channel: "preview" });
  native.receive({ requestId: "wrong", error: "must ignore" });
  native.receive({ requestId: sent[0]!.id, candidate });
  expect(await checking).toEqual(candidate);
  const progress: unknown[] = [];
  const staging = native.feed.stage(candidate, new AbortController().signal, value => progress.push(value));
  expect(sent[1]!.action).toEqual({ type: "stage", candidateId: candidate.summary.id });
  native.receive({ requestId: sent[1]!.id, progress: { received: 25, total: 50 } });
  native.receive({ requestId: sent[1]!.id, staged: true });
  await staging; expect(progress).toEqual([{ received: 25, total: 50 }]);
  const repair = native.checkRepair(new AbortController().signal);
  expect(sent[2]!.action).toEqual({ type: "checkRepair" });
  native.receive({ requestId: sent[2]!.id, error: "Current archive missing" });
  await expect(repair).rejects.toThrow("Current archive missing");
  native.close();
});
test("interrupted request stays exclusive until native completion and shutdown rejects it", async () => {
  let id = "";
  const native = createNativeAppImageUpdates(request => { id = request; });
  const controller = new AbortController();
  const request = native.feed.check("stable", controller.signal);
  controller.abort();
  await expect(request).rejects.toThrow("interrupted");
  await expect(native.feed.check("stable", new AbortController().signal)).rejects.toThrow("already running");
  native.receive({ requestId: id, candidate: null });
  const next = native.feed.check("stable", new AbortController().signal);
  native.close(); await expect(next).rejects.toThrow("connection closed");
});

test("installation uses opaque identities and preserves idle and Couch-only repair intent", async () => {
  const sent: { id: string; action: AppImageUpdateAction }[] = [];
  const native = createNativeAppImageUpdates((id, action) => sent.push({ id, action }));
  const requestId = "c".repeat(32);
  const installing = native.request({ op: "install", candidateId: candidate.summary.id, requestId, confirmInterrupt: false, whenIdle: true });
  expect(sent[0]!.action).toEqual({ type: "install", candidateId: candidate.summary.id, requestId, confirmInterrupt: false, whenIdle: true, repair: false, repairRuntime: false });
  native.receive({ requestId: sent[0]!.id, ok: true, transaction: null }); await installing;
  const repairing = native.request({ op: "repair-current", expectedCurrentId: candidate.summary.id, requestId, confirmInterrupt: true, repairRuntime: false });
  expect(sent[1]!.action).toMatchObject({ type: "install", repair: true, repairRuntime: false, whenIdle: false });
  native.receive({ requestId: sent[1]!.id, ok: true, transaction: null }); await repairing;
  const status = native.request({ op: "status", requestId });
  expect(sent[2]!.action).toEqual({ type: "status", requestId });
  native.receive({ requestId: sent[2]!.id, ok: true, transaction: null }); await status;
  native.close();
});

test("concurrent phone statuses correlate out of order without interrupting download progress", async () => {
  const sent: { id: string; action: AppImageUpdateAction }[] = [];
  const native = createNativeAppImageUpdates((id, action) => sent.push({ id, action }));
  const progress: unknown[] = [];
  const staging = native.feed.stage(candidate, new AbortController().signal, value => progress.push(value));
  const first = native.request({ op: "status", requestId: "first" });
  const second = native.request({ op: "status", requestId: "second" });
  expect(sent.slice(1).map(value => value.action)).toEqual([{ type: "status", requestId: "first" }, { type: "status", requestId: "second" }]);
  native.receive({ requestId: sent[2]!.id, ok: true, repairCurrent: false });
  native.receive({ requestId: sent[0]!.id, progress: { received: 25, total: 50 } });
  native.receive({ requestId: sent[1]!.id, ok: true, repairCurrent: true });
  expect((await first).repairCurrent).toBe(true);
  expect((await second).repairCurrent).toBe(false);
  await expect(native.checkRepair(new AbortController().signal)).rejects.toThrow("already running");
  native.receive({ requestId: sent[1]!.id, progress: { received: 999, total: 999 } });
  native.receive({ requestId: sent[0]!.id, progress: { received: 50, total: 50 } });
  native.receive({ requestId: sent[0]!.id, staged: true });
  await staging;
  expect(progress).toEqual([{ received: 25, total: 50 }, { received: 50, total: 50 }]);
  native.close();
});

test("timed-out status is cleaned up without releasing an interrupted mutation", async () => {
  const timeout = new AbortController();
  const timeoutSignal = spyOn(AbortSignal, "timeout").mockReturnValue(timeout.signal);
  const removeListener = spyOn(timeout.signal, "removeEventListener");
  const sent: string[] = [];
  const native = createNativeAppImageUpdates(id => { sent.push(id); });
  try {
    const controller = new AbortController();
    const checking = native.feed.check("stable", controller.signal);
    controller.abort();
    await expect(checking).rejects.toThrow("interrupted");
    const status = native.request({ op: "status" });
    expect(sent).toHaveLength(2);
    timeout.abort();
    await expect(status).rejects.toThrow("interrupted");
    expect(removeListener).toHaveBeenCalledTimes(1);
    native.receive({ requestId: sent[1]!, ok: true });
    expect(removeListener).toHaveBeenCalledTimes(1);
    await expect(native.feed.check("stable", new AbortController().signal)).rejects.toThrow("already running");
    native.receive({ requestId: sent[0]!, candidate: null });
    const next = native.feed.check("stable", new AbortController().signal);
    native.receive({ requestId: sent[2]!, candidate });
    expect(await next).toEqual(candidate);
  } finally {
    native.close();
    removeListener.mockRestore();
    timeoutSignal.mockRestore();
  }
});

test("pending phone statuses allow a mutation and shutdown rejects every caller", async () => {
  const native = createNativeAppImageUpdates(() => {});
  const first = native.request({ op: "status" });
  const second = native.request({ op: "status" });
  const checking = native.feed.check("preview", new AbortController().signal);
  const closed = Promise.allSettled([first, second, checking]);
  native.close();
  for (const result of await closed) {
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") expect(result.reason.message).toContain("connection closed");
  }
});

test("failed status dispatch preserves the running mutation", async () => {
  let mutationId = "";
  const native = createNativeAppImageUpdates((id, action) => {
    if (action.type === "status") throw new Error("disconnected");
    mutationId = id;
  });
  const checking = native.feed.check("stable", new AbortController().signal);
  await expect(native.request({ op: "status" })).rejects.toThrow("unavailable");
  await expect(native.feed.check("stable", new AbortController().signal)).rejects.toThrow("already running");
  native.receive({ requestId: mutationId, candidate });
  expect(await checking).toEqual(candidate);
  native.close();
});

test("accepted installation retains the restart reservation until terminal completion", async () => {
  const sent: { id: string; action: AppImageUpdateAction }[] = [];
  const native = createNativeAppImageUpdates((id, action) => sent.push({ id, action }));
  const installing = native.request({ op: "install", candidateId: candidate.summary.id, requestId: "d".repeat(32), confirmInterrupt: true });
  native.receive({ requestId: sent[0]!.id, ok: true, accepted: true });
  await installing;
  await expect(native.restart(true)).rejects.toThrow("already running");
  const status = native.request({ op: "status" });
  native.receive({ requestId: sent[1]!.id, ok: true });
  await status;
  native.receive({ requestId: sent[0]!.id, ok: true });
  const restarting = native.restart(true);
  await expect(native.feed.check("preview", new AbortController().signal)).rejects.toThrow("already running");
  native.receive({ requestId: sent[2]!.id, error: "The service is unsupervised." });
  await expect(restarting).rejects.toThrow("unsupervised");
  native.close();
});
