import { expect, test } from "bun:test";
import { createMaintenance, type MaintenanceBuild } from "./maintenance";

const build: MaintenanceBuild = { version: "2", revision: "b".repeat(40), dataFormat: 1 };
const transaction = { updateId: "a".repeat(32), nonce: "b".repeat(32), candidateId: "c".repeat(64), ...build, phase: "trial", disrupted: true, committed: false, confirmInterrupt: true };
function fixture() {
  let active: typeof transaction | null = { ...transaction };
  let player = "idle", checkpoints = 0, checkpointFailure = false;
  let native = async () => build;
  let frontend: MaintenanceBuild | null = build;
  const maintenance = createMaintenance({
    build, context: async () => ({ ok: true, context: active }), player: () => player,
    quiesce: async () => { checkpoints++; if (checkpointFailure) throw new Error("disk full"); return { progressSaved: true, admissionClosed: true }; },
    database: async () => {}, native: () => native(), frontend: () => frontend,
  });
  const request = (op: string, overrides = {}) => maintenance.handle({ op, protocol: "maintenance-v1", updateId: transaction.updateId, nonce: transaction.nonce, candidate: { candidateId: transaction.candidateId, ...build }, confirmInterrupt: true, ...overrides });
  return { maintenance, request, setActive: (value: typeof active) => active = value, setPlayer: (value: string) => player = value, setNative: (value: typeof native) => native = value, setFrontend: (value: typeof frontend) => frontend = value, failCheckpoint: () => checkpointFailure = true, checkpoints: () => checkpoints };
}

test("startup stays closed until private context is known and trial commits only after matching readiness", async () => {
  const f = fixture();
  expect(f.maintenance.admitted()).toBe(false);
  await f.maintenance.initialize();
  expect(f.maintenance.admitted()).toBe(false);
  f.setActive({ ...transaction, phase: "committing", committed: true });
  expect(await f.request("commit")).toMatchObject({ ok: false });
  f.setActive({ ...transaction });
  expect(await f.request("readiness")).toMatchObject({ ok: true, nativeBuild: build, frontendBuild: build, database: "ok" });
  f.setActive({ ...transaction, phase: "committing", committed: true });
  expect(await f.request("commit")).toMatchObject({ ok: true, admissionOpen: true });
  expect(f.maintenance.admitted()).toBe(true);
});

test("normal activated startup opens only with no unresolved transaction; bridge loss closes it", async () => {
  const f = fixture();
  f.setActive(null);
  await f.maintenance.initialize();
  expect(f.maintenance.admitted()).toBe(true);
  f.maintenance.fail();
  expect(f.maintenance.admitted()).toBe(false);
});

test("wrong nonce, failed native initialization and mismatched frontend cannot verify a trial", async () => {
  const f = fixture();
  await f.maintenance.initialize();
  expect(await f.request("readiness", { nonce: "d".repeat(32) })).toMatchObject({ ok: false });
  f.setNative(async () => { throw new Error("libmpv failed"); });
  expect(await f.request("readiness")).toMatchObject({ ok: false });
  f.setNative(async () => ({ ...build, revision: "d".repeat(40) }));
  expect(await f.request("readiness")).toMatchObject({ ok: false });
  f.setNative(async () => build);
  f.setFrontend({ ...build, version: "1" });
  expect(await f.request("readiness")).toMatchObject({ ok: false });
  f.setActive({ ...transaction, phase: "committing", committed: true });
  expect(await f.request("commit")).toMatchObject({ ok: false });
  expect(f.maintenance.admitted()).toBe(false);
});

test("a native reply after the root trial ended or bridge failed cannot verify readiness", async () => {
  const f = fixture();
  const started = Promise.withResolvers<void>(), native = Promise.withResolvers<MaintenanceBuild>();
  f.setNative(() => { started.resolve(); return native.promise; });
  await f.maintenance.initialize();
  const result = f.request("readiness");
  await started.promise;
  f.setActive({ ...transaction, phase: "operator-required" });
  native.resolve(build);
  expect(await result).toMatchObject({ ok: false });
  expect(f.maintenance.admitted()).toBe(false);
});

test("quiescing requires interruption confirmation and propagates checkpoint failure permanently", async () => {
  const f = fixture();
  f.setActive(null);
  await f.maintenance.initialize();
  f.setActive({ ...transaction, phase: "quiescing", confirmInterrupt: false });
  f.setPlayer("paused");
  expect(await f.request("quiesce", { confirmInterrupt: false })).toMatchObject({ ok: false, error: "Confirm interruption of the current playback before installing." });
  expect(f.checkpoints()).toBe(0);
  f.setActive({ ...transaction, phase: "quiescing" });
  f.failCheckpoint();
  expect(await f.request("quiesce")).toMatchObject({ ok: false });
  expect(f.checkpoints()).toBe(1);
  expect(f.maintenance.admitted()).toBe(false);
  expect(await f.request("quiesce")).toMatchObject({ ok: false });
  expect(f.checkpoints()).toBe(1);
});


test.each(["accepted", "preflight", "installing", "quiescing", "operator-required", "restoring", "committing"])("startup refuses %s before any stores can be constructed", async phase => {
  const f = fixture();
  f.setActive({ ...transaction, phase });
  expect(await f.maintenance.initialize().catch(error => error)).toBeInstanceOf(Error);
  expect(f.maintenance.admitted()).toBe(false);
});

test("startup rejects another candidate build and permits the root's authenticated restoration trial", async () => {
  const wrong = fixture();
  wrong.setActive({ ...transaction, version: "3" });
  expect(await wrong.maintenance.initialize().catch(error => error)).toBeInstanceOf(Error);
  const restored = fixture();
  // The private worker projects its restoration identity as phase trial only
  // after package/data restoration, before starting the previous application.
  restored.setActive({ ...transaction, nonce: "d".repeat(32) });
  await restored.maintenance.initialize();
  expect(restored.maintenance.admitted()).toBe(false);
  expect(await restored.request("readiness", { nonce: "d".repeat(32) })).toMatchObject({ ok: true });
});
