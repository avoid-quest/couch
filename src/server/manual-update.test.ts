import { expect, test } from "bun:test";
import { createManualUpdate } from "./manual-update";
import type { ControllerIdentity } from "../shared/controllers";
import type { UpdateTransaction } from "../shared/updates";

const payload = { candidateId: "a".repeat(64), requestId: "b".repeat(32), confirmInterrupt: true };
const admin = (): ControllerIdentity => ({ authority: "administrator", controller: null, claimAvailable: false });
const request = (body: unknown = payload) => new Request("http://localhost/api/updates/install", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ install: body }) });
const transaction: UpdateTransaction = { updateId: "c".repeat(32), requestId: payload.requestId, candidateId: payload.candidateId, version: "2", revision: "d".repeat(40), phase: "accepted", error: null, createdAt: 1, updatedAt: 1 };

test("only an administrator's exact staged candidate reaches the fixed worker operation", async () => {
  const calls: unknown[] = [];
  const manual = createManualUpdate({ request: async value => { calls.push(value); return value.op === "status" ? { ok: true, transaction: null } : { ok: true, transaction }; } }, () => true, id => id === payload.candidateId);
  expect((await manual.install(request(), () => null)).status).toBe(401);
  expect((await manual.install(request(), () => ({ authority: "host", controller: null, claimAvailable: false }))).status).toBe(403);
  expect(calls).toEqual([]);
  for (const bad of [{ ...payload, path: "/tmp/package.deb" }, { ...payload, candidateId: "https://feed.example/release" }, { ...payload, confirmInterrupt: "yes" }]) expect((await manual.install(request(bad), admin)).status).toBe(400);
  expect(calls).toEqual([]);
  expect((await manual.install(request(), admin)).status).toBe(202);
  expect(calls.at(-1)).toEqual({ op: "install", ...payload });
  expect(manual.busy()).toBe(true);
  expect((await manual.install(request({ ...payload, requestId: "e".repeat(32) }), admin)).status).toBe(409);
});

test("revocation during worker lookup prevents acceptance; status remains readable during trial", async () => {
  const gate = Promise.withResolvers<unknown>();
  const calls: string[] = [];
  let allowed = true;
  const identity = () => allowed ? admin() : null;
  const manual = createManualUpdate({ request: async value => { calls.push(value.op); return gate.promise; } }, () => true, () => true);
  const response = manual.install(request(), identity);
  await Bun.sleep(0);
  allowed = false;
  gate.resolve({ ok: true, transaction: null });
  expect((await response).status).toBe(401);
  expect(calls).toEqual(["status"]);
  const trial = createManualUpdate({ request: async () => ({ ok: true, transaction: { ...transaction, phase: "trial" } }) }, () => false, () => false);
  expect(await trial.read(admin)).toMatchObject({ enabled: true, transaction: { phase: "trial" } });
});

test("a durable retry reaches the worker with the same fields after download state is lost", async () => {
  const calls: unknown[] = [];
  const manual = createManualUpdate({ request: async value => { calls.push(value); return { ok: true, transaction }; } }, () => false, () => false);
  expect((await manual.install(request(), admin)).status).toBe(202);
  expect(calls.at(-1)).toEqual({ op: "install", ...payload });
  const restored = createManualUpdate({ request: async () => ({ ok: true, transaction: { ...transaction, phase: "restored" } }) }, () => true, () => true);
  await restored.read(admin);
  expect(restored.busy()).toBe(false);
});
