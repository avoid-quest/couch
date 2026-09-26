import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ControllerIdentity } from "../shared/controllers";
import type { UpdateFeed, UpdateRelease } from "./update-feed";
import { UpdateError } from "./update-feed";
import { createUpdates } from "./updates";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
const admin = (): ControllerIdentity => ({ authority: "administrator", controller: null, claimAvailable: false });
const candidate = { summary: { id: "a".repeat(64), releaseId: "2.1", version: "0.1.0+build.2.1", revision: "b".repeat(40), notes: "new", bytes: 50, publishedAt: Date.now(), expiresAt: Date.now() + 60_000 } } as UpdateRelease;
async function setup(feed?: UpdateFeed) {
  const directory = await mkdtemp(join(tmpdir(), "couch-updates-state-"));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const updates = createUpdates(directory, { version: "0.1.0", revision: "c".repeat(40) }, feed);
  cleanup.push(() => updates.close());
  return { updates, directory };
}
const request = (path = "", body?: unknown) => new Request(`http://localhost/api/updates${path}`, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const state = async (updates: ReturnType<typeof createUpdates>) => (await updates.handle(request(), admin)).json();
async function settled(updates: ReturnType<typeof createUpdates>, ready: (value: any) => boolean = value => !["checking", "downloading"].includes(value.status)) { for (let i = 0; i < 50; i++) { const value = await state(updates); if (ready(value)) return value; await Bun.sleep(5); } throw new Error("job never settled"); }

test("defaults stable/manual, accepts only admin commands and bounded fields", async () => {
  const { updates } = await setup({ check: async () => candidate, stage: async () => {} });
  expect(await state(updates)).toMatchObject({ channel: "stable", policy: "manual", running: { version: "0.1.0" } });
  expect((await updates.handle(request(), () => null)).status).toBe(401);
  for (const authority of ["controller"] as const) expect((await updates.handle(request("/check", { check: true }), () => ({ ...admin(), authority }))).status).toBe(403);
  expect((await updates.handle(request("/channel", { channel: "preview", url: "https://evil" }), admin)).status).toBe(400);
  expect((await updates.handle(request("/channel", { channel: "nightly" }), admin)).status).toBe(400);
});

test("channel persists separately, checks asynchronously, stages only its exact candidate", async () => {
  const gate = Promise.withResolvers<UpdateRelease | null>(), calls: string[] = [];
  const { updates, directory } = await setup({ check: async channel => { calls.push(channel); return gate.promise; }, stage: async value => { expect(value).toBe(candidate); } });
  expect((await updates.handle(request("/channel", { channel: "preview" }), admin)).status).toBe(202);
  expect(await state(updates)).toMatchObject({ channel: "preview", policy: "manual", status: "checking", currentCheck: false });
  expect((await updates.handle(request("/check", { check: true }), admin)).status).toBe(409);
  gate.resolve(candidate); expect(await settled(updates)).toMatchObject({ status: "available", currentCheck: true });
  expect((await updates.handle(request("/stage", { candidateId: "other" }), admin)).status).toBe(409);
  expect((await updates.handle(request("/stage", { candidateId: candidate.summary.id }), admin)).status).toBe(202);
  expect((await settled(updates)).status).toBe("ready");
  const saved = JSON.parse(await readFile(join(directory, "settings.json"), "utf8"));
  expect(saved).toMatchObject({ channel: "preview", policy: "manual" });
  expect(JSON.stringify(saved)).not.toContain("ready");
  await updates.close();
  const restarted = createUpdates(directory, { version: "0.1.0", revision: null }, { check: async () => candidate, stage: async () => {} }); cleanup.push(() => restarted.close());
  expect(await state(restarted)).toMatchObject({ status: "idle", currentCheck: false, channel: "preview", candidate: candidate.summary });
  expect((await restarted.handle(request("/stage", { candidateId: candidate.summary.id }), admin)).status).toBe(409);
  expect(calls).toEqual(["preview"]);
});

test("offline check keeps last known release and timestamp without claiming fresh success", async () => {
  let offline = false;
  const { updates } = await setup({ check: async () => { if (offline) throw new UpdateError("Feed offline. Keep the Mac awake."); return candidate; }, stage: async () => {} });
  await updates.handle(request("/check", { check: true }), admin); const first = await settled(updates);
  offline = true; await updates.handle(request("/check", { check: true }), admin);
  expect(await settled(updates)).toMatchObject({ status: "failed", currentCheck: false, candidate: candidate.summary, lastSuccessfulCheck: first.lastSuccessfulCheck, error: "Feed offline. Keep the Mac awake." });
  expect((await updates.handle(request("/stage", { candidateId: candidate.summary.id }), admin)).status).toBe(409);
});

test("unpackaged installation reports unavailable and never accepts a fake download", async () => {
  const { updates } = await setup();
  expect((await state(updates)).status).toBe("unavailable");
  expect((await updates.handle(request("/stage", { candidateId: candidate.summary.id }), admin)).status).toBe(409);
});

test("signing-key mismatch blocks the same candidate across rechecks until the feed changes", async () => {
  const mismatch = "The signature was created with a different key than the one provided";
  let release = candidate, offline = false, stages = 0;
  const { updates } = await setup({
    check: async () => { if (offline) throw new UpdateError("Feed offline"); return release; },
    stage: async () => { stages++; if (release === candidate) throw new UpdateError(mismatch); },
  });
  await updates.handle(request("/check", { check: true }), admin); await settled(updates);
  await updates.handle(request("/stage", { candidateId: candidate.summary.id }), admin);
  expect(await settled(updates)).toMatchObject({ status: "failed", error: mismatch });
  expect((await updates.handle(request("/stage", { candidateId: candidate.summary.id }), admin)).status).toBe(409);
  offline = true;
  await updates.handle(request("/check", { check: true }), admin);
  expect(await settled(updates)).toMatchObject({ status: "failed", currentCheck: false, error: "Feed offline" });
  offline = false;
  for (let i = 0; i < 2; i++) {
    await updates.handle(request("/check", { check: true }), admin);
    expect(await settled(updates)).toMatchObject({ status: "failed", currentCheck: true, error: mismatch });
    expect((await updates.handle(request("/stage", { candidateId: candidate.summary.id }), admin)).status).toBe(409);
  }
  expect(stages).toBe(1);
  release = { ...candidate, summary: { ...candidate.summary, id: "c".repeat(64) } };
  await updates.handle(request("/check", { check: true }), admin);
  expect(await settled(updates)).toMatchObject({ status: "available", error: null });
  expect((await updates.handle(request("/stage", { candidateId: release.summary.id }), admin)).status).toBe(202);
  expect(await settled(updates)).toMatchObject({ status: "ready", error: null });
  expect(stages).toBe(2);
});


test("trial startup does not run background update producers until admission opens", async () => {
  let open = false, checks = 0;
  const directory = await mkdtemp(join(tmpdir(), "couch-trial-updates-"));
  const updates = createUpdates(directory, { version: "1", revision: "a".repeat(40) }, { check: async () => { checks++; return null; }, stage: async () => {} } as unknown as UpdateFeed, 5, () => open);
  try {
    await Bun.sleep(20);
    expect(checks).toBe(0);
    expect((await updates.handle(request("/check", {}), admin)).status).toBe(503);
    open = true;
    await settled(updates, () => checks > 0);
    expect(checks).toBeGreaterThan(0);
  } finally { await updates.close(); await rm(directory, { recursive: true, force: true }); }
});

async function automaticSetup() {
  let waiting: string | null = "Waiting for stopped playback";
  const records = new Map<string, import("../shared/updates").UpdateTransaction>();
  const installations: { candidateId: string; requestId: string }[] = [];
  let stages = 0, offline = false, lostReply = false;
  const directory = await mkdtemp(join(tmpdir(), "couch-auto-updates-"));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const feed: UpdateFeed = { check: async () => { if (offline) throw new UpdateError("Feed offline"); return candidate; }, stage: async () => { stages++; } };
  const automation = {
    busy: () => false, idle: () => waiting,
    status: async (id?: string) => id ? records.get(id) ?? null : [...records.values()].at(-1) ?? null,
    install: async (candidateId: string, requestId: string, guard: () => void) => {
      guard(); installations.push({ candidateId, requestId });
      const result: import("../shared/updates").UpdateTransaction = { candidateId, requestId, updateId: "c".repeat(32), version: candidate.summary.version, revision: candidate.summary.revision, createdAt: 1, updatedAt: 1, phase: "accepted", error: null };
      records.set(requestId, result);
      if (lostReply) throw new Error("Reply disconnected");
      return result;
    },
  };
  const open = () => { const updates = createUpdates(directory, { version: "1", revision: null }, feed, undefined, undefined, automation); cleanup.push(() => updates.close()); return updates; };
  const updates = open();
  return { updates, directory, open, records, installations, stages: () => stages, idle: (value: string | null) => waiting = value, offline: () => offline = true, loseReply: () => lostReply = true };
}

test("auto policy persists independently of either channel and stages without interrupting busy playback", async () => {
  const f = await automaticSetup();
  await f.updates.handle(request("/check", { check: true }), admin); await settled(f.updates);
  await f.updates.automatic(); expect(f.stages()).toBe(0);
  expect((await f.updates.handle(request("/policy", { policy: "idle" }), admin)).status).toBe(202);
  await f.updates.automatic(); await settled(f.updates);
  expect(f.stages()).toBe(1); expect(f.installations).toEqual([]);
  await f.updates.automatic(); expect(f.updates.state.waiting).toContain("stopped playback");
  await f.updates.handle(request("/channel", { channel: "preview" }), admin); await settled(f.updates);
  expect(f.updates.state.policy).toBe("idle");
  await f.updates.close();
  expect(f.open().state).toMatchObject({ policy: "idle", channel: "preview", currentCheck: false });
});

test.each(["failed", "operator-required", "restored"] as const)("automatic attempts retain identity after lost reply and never repeat a %s candidate", async phase => {
  const f = await automaticSetup();
  await f.updates.handle(request("/policy", { policy: "idle" }), admin);
  await f.updates.handle(request("/check", { check: true }), admin); await settled(f.updates);
  await f.updates.automatic(); await settled(f.updates);
  f.idle(null); f.loseReply(); await f.updates.automatic();
  expect(f.installations).toHaveLength(1);
  const attempted = f.installations[0]!;
  expect(JSON.parse(await readFile(join(f.directory, "settings.json"), "utf8")).attempt).toEqual(attempted);
  await f.updates.automatic(); expect(f.installations).toHaveLength(1);
  f.records.set(attempted.requestId, { ...f.records.get(attempted.requestId)!, phase, error: "The startup trial failed. Recover through SSH.", ...(phase === "restored" ? { restoredVersion: "1", restoredRevision: "previous" } : {}) });
  await f.updates.automatic(); expect(f.installations).toHaveLength(1);
  expect(f.updates.state.waiting).toContain("already had an automatic attempt");
  await f.updates.close();
  const restarted = f.open();
  await restarted.handle(request("/check", { check: true }), admin); await settled(restarted);
  await restarted.automatic(); expect(f.installations).toHaveLength(1);
  expect(f.records.get(attempted.requestId)).toMatchObject({ phase, error: "The startup trial failed. Recover through SSH." });
});

test("an idle refusal can retry after a fresh idle interval, while offline checks never install", async () => {
  const f = await automaticSetup();
  await f.updates.handle(request("/policy", { policy: "idle" }), admin);
  await f.updates.handle(request("/check", { check: true }), admin); await settled(f.updates);
  await f.updates.automatic(); await settled(f.updates);
  f.idle(null); await f.updates.automatic();
  const attempted = f.installations[0]!;
  f.records.set(attempted.requestId, { ...f.records.get(attempted.requestId)!, phase: "failed", idleDeferred: true });
  f.idle("New remote activity. Waiting five minutes.");
  await f.updates.automatic(); expect(f.installations).toHaveLength(1);
  f.idle(null); await f.updates.automatic();
  expect(f.installations).toHaveLength(2); expect(f.installations[1]!.requestId).not.toBe(attempted.requestId);
  f.records.clear(); f.offline();
  await f.updates.handle(request("/check", { check: true }), admin); await settled(f.updates);
  await f.updates.automatic();
  expect(f.updates.state.currentCheck).toBe(false); expect(f.installations).toHaveLength(2);
});

test("fresh native verification restores ready staging, corruption clears ready without losing preferences", async () => {
  let staged = true;
  const { updates, directory } = await setup({ check: async () => ({ ...candidate, staged }), stage: async () => {} });
  await updates.handle(request("/channel", { channel: "preview" }), admin);
  expect(await settled(updates)).toMatchObject({ status: "ready", currentCheck: true, channel: "preview", policy: "manual" });
  staged = false;
  await updates.handle(request("/check", { check: true }), admin);
  expect(await settled(updates)).toMatchObject({ status: "available", currentCheck: true });
  await updates.close();
  const restarted = createUpdates(directory, { version: "0.1.0", revision: null }, { check: async () => ({ ...candidate, staged: true }), stage: async () => {} }); cleanup.push(() => restarted.close());
  expect(await state(restarted)).toMatchObject({ status: "idle", currentCheck: false, channel: "preview", policy: "manual" });
  await restarted.handle(request("/check", { check: true }), admin);
  expect(await settled(restarted)).toMatchObject({ status: "ready", currentCheck: true });
});


test("a failed manual candidate is never automatically retried", async () => {
  const f = await automaticSetup();
  f.records.set("d".repeat(32), { candidateId: candidate.summary.id, requestId: "d".repeat(32), updateId: "e".repeat(32), version: candidate.summary.version, revision: candidate.summary.revision, createdAt: 1, updatedAt: 1, phase: "operator-required", error: "Failed startup" });
  await f.updates.handle(request("/policy", { policy: "idle" }), admin);
  await f.updates.handle(request("/check", { check: true }), admin); await settled(f.updates);
  f.idle(null); await f.updates.automatic();
  expect(f.installations).toHaveLength(0);
  expect(f.updates.state.waiting).toContain("required recovery");
});
