import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ControllerIdentity } from "../shared/controllers";
import type { UpdateFeed, VerifiedRelease } from "./update-feed";
import { UpdateError } from "./update-feed";
import { createUpdates } from "./updates";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
const admin = (): ControllerIdentity => ({ authority: "administrator", controller: null, claimAvailable: false });
const candidate = { summary: { id: "a".repeat(64), releaseId: "2.1", version: "0.1.0+build.2.1", revision: "b".repeat(40), notes: "new", bytes: 50, publishedAt: Date.now(), expiresAt: Date.now() + 60_000 } } as VerifiedRelease;
async function setup(feed?: UpdateFeed) {
  const directory = await mkdtemp(join(tmpdir(), "couch-updates-state-"));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const updates = createUpdates(directory, { version: "0.1.0", revision: "c".repeat(40) }, feed);
  cleanup.push(() => updates.close());
  return { updates, directory };
}
const request = (path = "", body?: unknown) => new Request(`http://localhost/api/updates${path}`, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const state = async (updates: ReturnType<typeof createUpdates>) => (await updates.handle(request(), admin)).json();
async function settled(updates: ReturnType<typeof createUpdates>) { for (let i = 0; i < 50; i++) { const value = await state(updates); if (!["checking", "downloading"].includes(value.status)) return value; await Bun.sleep(5); } throw new Error("job never settled"); }

test("defaults stable/manual, accepts only admin commands and bounded fields", async () => {
  const { updates } = await setup({ check: async () => candidate, stage: async () => {} });
  expect(await state(updates)).toMatchObject({ channel: "stable", policy: "manual", running: { version: "0.1.0" } });
  expect((await updates.handle(request(), () => null)).status).toBe(401);
  for (const authority of ["controller", "host"] as const) expect((await updates.handle(request("/check", { check: true }), () => ({ ...admin(), authority }))).status).toBe(403);
  expect((await updates.handle(request("/channel", { channel: "preview", url: "https://evil" }), admin)).status).toBe(400);
  expect((await updates.handle(request("/channel", { channel: "nightly" }), admin)).status).toBe(400);
});

test("channel persists separately, checks asynchronously, stages only its exact candidate", async () => {
  const gate = Promise.withResolvers<VerifiedRelease | null>(), calls: string[] = [];
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
