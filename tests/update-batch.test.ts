import { expect, test } from "bun:test";
import type { UpdateState } from "../src/shared/updates";
import { batchActive, batchLifetime, createUpdateBatch, restoreUpdateBatch, runUpdateBatch, saveUpdateBatch, updateBatchKey, type UpdateBatch } from "../src/client/session/update-batch";

const ready: UpdateState = { version: "0.4.0", available: "0.4.1", channel: "preview", status: "ready", progress: null, checkedAt: 1, error: null };
const target = (id: string) => ({ id, name: id, state: ready });
const planned = () => createUpdateBatch([target("app"), target("host"), target("tv"), target("laptop")], ["app", "host", "tv", "laptop"], true, false, 10);

function harness(initial = planned()) {
  let saved = JSON.stringify(initial);
  let current = initial;
  const events: string[] = [];
  const controller = new AbortController();
  const actions = {
    signal: controller.signal, now: () => 20,
    save: (next: UpdateBatch) => { saved = JSON.stringify(next); },
    changed: (next: UpdateBatch) => { current = next; },
    helpers: async (resume: boolean) => { events.push(resume ? "observe helpers" : "helpers"); },
    install: async (item: UpdateBatch["items"][number], interrupt: boolean) => {
      const persisted = restoreUpdateBatch(saved, 20)!;
      expect(persisted.items.find(value => value.id === item.id)?.status).toBe("installing");
      expect(interrupt).toBe(initial.interrupt === true);
      events.push(`install ${item.id}`);
    },
    confirm: async (item: UpdateBatch["items"][number]) => { events.push(`confirm ${item.id}`); },
  };
  return { actions, controller, events, current: () => current, saved: () => saved };
}

test("only selected ready apps are planned, without duplicates, preserving each offered version", () => {
  const batch = createUpdateBatch([target("app"), target("host"), target("tv"), { ...target("old"), state: { ...ready, status: "up-to-date" } }, { ...target("other"), state: { ...ready, available: "0.5.0-preview.2" } }], ["app", "tv", "host", "tv", "other"], true);
  expect(batch.items.map(item => [item.id, item.version])).toEqual([["tv", "0.4.1"], ["other", "0.5.0-preview.2"], ["host", "0.4.1"], ["app", "0.4.1"]]);
});

test("unavailable selected targets cannot silently become a successful dependency-only batch", () => {
  expect(() => createUpdateBatch([target("app")], ["missing"], true)).toThrow("isn't ready to update");
  expect(() => createUpdateBatch([{ id: "offline", name: "Living room" }], ["offline"], true)).toThrow("Living room isn't ready");
  expect(() => createUpdateBatch([{ ...target("host"), state: { ...ready, status: "up-to-date" } }], ["host"], true)).toThrow("isn't ready to update");
});

test("an explicitly skipped unsupported helper API still permits updating the old app", async () => {
  const batch = planned();
  batch.helpers = "skipped"; batch.helperError = "Media tool maintenance is unsupported";
  const run = harness(batch);
  await runUpdateBatch(batch, run.actions);
  expect(run.events[0]).toBe("install tv");
  expect(run.current().helpers).toBe("skipped");
  expect(run.current().helperError).toBe("Media tool maintenance is unsupported");
  expect(batchActive(run.current())).toBe(false);
});

test("maintenance precedes clients, then host, then local app; each restart waits for confirmation", async () => {
  const run = harness();
  await runUpdateBatch(planned(), run.actions);
  expect(run.events).toEqual(["helpers", "install tv", "confirm tv", "install laptop", "confirm laptop", "install host", "confirm host", "install app", "confirm app"]);
  expect(run.current().items.every(item => item.status === "updated")).toBe(true);
  expect(batchActive(run.current())).toBe(false);
});

test("dependency-only batches run maintenance and non-admin app batches skip it", async () => {
  const dependency = createUpdateBatch([], [], true, false, 10);
  const run = harness(dependency);
  await runUpdateBatch(dependency, run.actions);
  expect(run.events).toEqual(["helpers"]);
  expect(run.current().helpers).toBe("updated");
  const app = createUpdateBatch([target("app")], ["app"], false, true, 10);
  const own = harness(app);
  await runUpdateBatch(app, own.actions);
  expect(own.events).toEqual(["install app", "confirm app"]);
});

test("partial failure keeps successful results and stops dependent host and app restarts", async () => {
  const run = harness();
  run.actions.confirm = async item => { if (item.id === "laptop") throw new Error("Still on the old release"); };
  await runUpdateBatch(planned(), run.actions);
  expect(run.current().items.map(item => item.status)).toEqual(["updated", "failed", "waiting", "waiting"]);
  expect(run.current().items[1]?.error).toBe("Still on the old release");
  expect(run.events).toEqual(["helpers", "install tv", "install laptop"]);
  expect(batchActive(run.current())).toBe(false);
  const retry = createUpdateBatch([target("laptop"), target("host"), target("app")], ["laptop"], true, false, 30);
  expect(retry.items.map(item => item.id)).toEqual(["laptop"]);
});

test("helper failure is explicit and blocks all app restarts", async () => {
  const run = harness();
  run.actions.helpers = async () => { throw new Error("yt-dlp: download failed"); };
  await runUpdateBatch(planned(), run.actions);
  expect(run.events).toEqual([]);
  expect(run.current().helperError).toBe("yt-dlp: download failed");
  expect(run.current().helpers).toBe("failed");
  expect(batchActive(run.current())).toBe(false);
});

test("reload observes the saved install without repeating it, then resumes waiting steps", async () => {
  const run = harness();
  run.actions.install = async item => { run.events.push(item.id); run.controller.abort(); };
  await runUpdateBatch(planned(), run.actions);
  const restored = restoreUpdateBatch(run.saved(), 30)!;
  expect(restored.items[0]?.status).toBe("installing");
  const resumed = harness(restored);
  await runUpdateBatch(restored, resumed.actions);
  expect(resumed.events).toEqual(["confirm tv", "install laptop", "confirm laptop", "install host", "confirm host", "install app", "confirm app"]);
  const summary = restoreUpdateBatch(resumed.saved(), 30)!;
  const settled = harness(summary);
  await runUpdateBatch(summary, settled.actions);
  expect(settled.events).toEqual([]);
});

test("an uncertain restored install cannot advance the remaining batch", async () => {
  const batch = planned();
  batch.helpers = "updated";
  batch.items[0] = { ...batch.items[0]!, status: "installing", startedAt: 12 };
  const run = harness(batch);
  run.actions.confirm = async () => { throw new Error("Could not confirm the running version"); };
  await runUpdateBatch(batch, run.actions);
  expect(run.events).toEqual([]);
  expect(run.current().items.map(item => item.status)).toEqual(["failed", "waiting", "waiting", "waiting"]);
});

test("helper recovery observes maintenance without starting it twice", async () => {
  const batch = planned();
  batch.helpers = "checking"; batch.helperStartedAt = 12;
  const run = harness(batch);
  await runUpdateBatch(batch, run.actions);
  expect(run.events[0]).toBe("observe helpers");
});

test("playback rejection remains a failed step and is returned for explicit confirmation", async () => {
  const run = harness();
  const rejection = new Error("Updating will stop playback");
  run.actions.install = async () => { throw rejection; };
  expect(await runUpdateBatch(planned(), run.actions)).toBe(rejection);
  expect(run.current().items[0]?.status).toBe("failed");
  expect(run.current().items[0]?.error).toBe(rejection.message);
  expect(run.current().items.slice(1).every(item => item.status === "waiting")).toBe(true);
});

test("blocked or silently discarded storage prevents any disruptive action", async () => {
  for (const storage of [
    { getItem: () => null, setItem: () => { throw new Error("Quota exceeded"); } },
    { getItem: () => null, setItem: () => {} },
  ]) {
    expect(() => saveUpdateBatch(storage, "batch", planned())).toThrow("Couldn't save update progress");
    const run = harness();
    run.actions.save = next => saveUpdateBatch(storage, "batch", next);
    await runUpdateBatch(planned(), run.actions);
    expect(run.events).toEqual([]);
    expect(batchActive(run.current())).toBe(false);
  }
});

test("a checkpoint failure after a confirmed client stops later restarts", async () => {
  const run = harness();
  const save = run.actions.save;
  run.actions.save = next => { if (next.items[0]?.status === "updated") throw new Error("Storage full"); save(next); };
  await runUpdateBatch(planned(), run.actions);
  expect(run.events).toEqual(["helpers", "install tv", "confirm tv"]);
  expect(run.current().items[0]?.error).toBe("Storage full");
});

test("a suspended page cannot use old interruption permission for a later restart", async () => {
  const batch = planned();
  batch.interrupt = true;
  const run = harness(batch);
  let now = 20;
  run.actions.now = () => now;
  run.actions.confirm = async () => { now += batchLifetime; };
  await runUpdateBatch(batch, run.actions);
  expect(run.events).toEqual(["helpers", "install tv"]);
  expect(run.current().items[0]?.status).toBe("updated");
  expect(run.current().items[1]?.error).toContain("expired");
});

test("restore rejects expired, malformed, duplicate and reordered intent", () => {
  expect(restoreUpdateBatch(JSON.stringify(planned()), 10 + batchLifetime + 1)).toBeNull();
  expect(restoreUpdateBatch("{" )).toBeNull();
  expect(restoreUpdateBatch(JSON.stringify({ ...planned(), items: [planned().items[0], planned().items[0]] }), 20)).toBeNull();
  expect(restoreUpdateBatch(JSON.stringify({ ...planned(), items: [...planned().items].reverse() }), 20)).toBeNull();
  expect(restoreUpdateBatch(JSON.stringify({ ...planned(), items: [{ ...planned().items[0], status: "installing" }] }), 20)).toBeNull();
  expect(restoreUpdateBatch(JSON.stringify(planned()), 20)).toEqual(planned());
  expect(updateBatchKey("https://one", "install", "viewer")).not.toBe(updateBatchKey("https://two", "install", "viewer"));
  expect(updateBatchKey("https://one", "install", "viewer")).not.toBe(updateBatchKey("https://one", "other", "viewer"));
  expect(updateBatchKey("https://one", "install", "viewer")).not.toBe(updateBatchKey("https://one", "install", "other"));
});
