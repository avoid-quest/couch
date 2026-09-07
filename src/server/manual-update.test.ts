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
  const manual = createManualUpdate({ request: async value => { calls.push(value); return value.op === "status" ? { ok: true, repairCurrent: true, transaction: null } : { ok: true, repairCurrent: true, transaction }; } }, () => true, id => id === payload.candidateId);
  expect((await manual.install(request(), () => null)).status).toBe(401);
  expect((await manual.install(request(), () => ({ authority: "host", controller: null, claimAvailable: false }))).status).toBe(403);
  expect(calls).toEqual([]);
  for (const bad of [{ ...payload, path: "/tmp/package.deb" }, { ...payload, whenIdle: true }, { ...payload, candidateId: "https://feed.example/release" }, { ...payload, confirmInterrupt: "yes" }]) expect((await manual.install(request(bad), admin)).status).toBe(400);
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
  gate.resolve({ ok: true, repairCurrent: true, transaction: null });
  expect((await response).status).toBe(401);
  expect(calls).toEqual(["status"]);
  const trial = createManualUpdate({ request: async () => ({ ok: true, repairCurrent: true, transaction: { ...transaction, phase: "trial" } }) }, () => false, () => false);
  expect(await trial.read(admin)).toMatchObject({ enabled: true, transaction: { phase: "trial" } });
});

test("a durable retry reaches the worker with the same fields after download state is lost", async () => {
  const calls: unknown[] = [];
  const manual = createManualUpdate({ request: async value => { calls.push(value); return { ok: true, repairCurrent: true, transaction }; } }, () => false, () => false);
  expect((await manual.install(request(), admin)).status).toBe(202);
  expect(calls.at(-1)).toEqual({ op: "install", ...payload });
  const restored = createManualUpdate({ request: async () => ({ ok: true, repairCurrent: true, transaction: { ...transaction, phase: "restored" } }) }, () => true, () => true);
  await restored.read(admin);
  expect(restored.busy()).toBe(false);
});


test("expired unaccepted candidates are distinguished from ambiguous worker failure", async () => {
  const stale = createManualUpdate({ request: async () => ({ ok: true, repairCurrent: true, transaction: null }) }, () => true, () => false);
  expect(await (await stale.install(request(), admin)).json()).toMatchObject({ accepted: false });
  const ambiguous = createManualUpdate({ request: async value => { if (value.op === "install") throw new Error("lost reply"); return { ok: true, repairCurrent: true, transaction: null }; } }, () => true, () => true);
  expect(await (await ambiguous.install(request(), admin)).json()).not.toHaveProperty("accepted");
});

test("request-specific status retains a completed receipt superseded by another remote", async () => {
  const latest = { ...transaction, requestId: "e".repeat(32), phase: "succeeded" };
  const previous = { ...transaction, phase: "failed" };
  const manual = createManualUpdate({ request: async value => ({ ok: true, repairCurrent: true, transaction: value.op === "status" && value.requestId === payload.requestId ? previous : latest }) }, () => true, () => true);
  expect(await manual.read(admin, payload.requestId)).toMatchObject({ transaction: latest, requestedTransaction: previous });
  expect(manual.busy()).toBe(false);
});


test("automatic requests recheck new input after worker lookup and retain the private idle constraint", async () => {
  const gate = Promise.withResolvers<unknown>(), calls: unknown[] = [];
  let idle = true;
  const manual = createManualUpdate({ request: async value => { calls.push(value); return value.op === "status" ? gate.promise : { ok: true, repairCurrent: true, transaction }; } }, () => true, () => true);
  const guard = () => { if (!idle) throw new Error("New controller input"); };
  const pending = manual.automatic(payload.candidateId, payload.requestId, guard);
  idle = false; gate.resolve({ ok: true, repairCurrent: true, transaction: null });
  await expect(pending).rejects.toThrow("New controller input");
  expect(calls).toEqual([{ op: "status", requestId: payload.requestId }]);
  idle = true;
  await manual.automatic(payload.candidateId, payload.requestId, guard);
  expect(calls.at(-1)).toEqual({ op: "install", candidateId: payload.candidateId, requestId: payload.requestId, confirmInterrupt: false, whenIdle: true });
});

test("repair is an administrator's exact-current intent and never consults the newer staged candidate", async () => {
  const calls: unknown[] = [], current = { candidateId: "d".repeat(64), version: "1", revision: "previous" };
  let idle = true;
  const repair = { expectedCurrentId: current.candidateId, requestId: payload.requestId, confirmInterrupt: false, repairRuntime: true };
  const request = (body: unknown = repair) => new Request("http://localhost/api/updates/repair", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ repair: body }) });
  const manual = createManualUpdate({ request: async value => { calls.push(value); return { ok: true, repairCurrent: true, current, transaction: value.op === "status" ? null : { ...transaction, intent: "repair-current" } }; } }, () => true, () => { throw new Error("Repair cannot select staged releases"); }, () => idle);
  expect((await manual.repair(request(), () => null)).status).toBe(401);
  expect((await manual.repair(request({ ...repair, package: "other" }), admin)).status).toBe(400);
  expect(calls).toEqual([]);
  expect(await (await manual.repair(request({ ...repair, expectedCurrentId: payload.candidateId }), admin)).json()).toMatchObject({ accepted: false });
  idle = false; expect((await manual.repair(request(), admin)).status).toBe(409);
  idle = true; expect((await manual.repair(request(), admin)).status).toBe(202);
  expect(calls.at(-1)).toEqual({ op: "repair-current", ...repair });
});

test("unavailable enrolled installation rejects work until native status becomes available", async () => {
  let upgraded = false;
  const calls: string[] = [];
  const manual = createManualUpdate({ request: async value => { calls.push(value.op); return { ok: true, transaction: null, ...(upgraded ? { repairCurrent: true, current: { candidateId: payload.candidateId, version: "current", revision: "a".repeat(40) } } : {}) }; } }, () => true, () => true);
  expect(await manual.read(admin)).toMatchObject({ repairAvailable: false, current: null });
  expect(manual.needsRefresh()).toBe(true);
  expect(await (await manual.install(request(), admin)).json()).toMatchObject({ accepted: false });
  await expect(manual.automatic(payload.candidateId, payload.requestId, () => {})).rejects.toThrow("AppImage installation");
  expect(calls.every(op => op === "status")).toBe(true);
  upgraded = true;
  expect(await manual.read(admin)).toMatchObject({ repairAvailable: true, current: { candidateId: payload.candidateId } });
  expect(manual.needsRefresh()).toBe(false);
});
