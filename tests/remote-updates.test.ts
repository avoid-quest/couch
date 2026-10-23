import { expect, test } from "bun:test";
import { updateSettings } from "../src/server/updates-settings";
import { createNativeUpdates } from "../src/server/updates-native";
import type { UpdateAction, UpdateState } from "../src/shared/app-bridge";
import type { DeviceIdentity } from "../src/shared/devices";
import { parseUpdateOutcome, UPDATE_INTERRUPTS_PLAYBACK } from "../src/shared/updates";

const state: UpdateState = { version: "0.3.0", channel: "latest", status: "ready", available: "0.3.1", progress: null, checkedAt: null, error: null };
const identity = (authority: DeviceIdentity["authority"]): DeviceIdentity => ({ authority, device: null, claimAvailable: false });
const request = (path: string, body?: unknown) => new Request(`http://localhost${path}`, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

test("only paired administrators and the native host can update a selected app", async () => {
  const calls: Array<[UpdateAction, string]> = [];
  const invoke = async (action: UpdateAction, device: string) => { calls.push([action, device]); return state; };
  for (const caller of [null, identity("controller")]) {
    const response = await updateSettings(request("/api/updates/install", { version: "0.3.1" }), () => caller, invoke);
    expect(response.status).toBe(caller ? 403 : 401);
  }
  expect(calls).toEqual([]);
  const device = "a".repeat(43);
  const response = await updateSettings(request(`/api/updates/install?device=${device}`, { version: "0.3.1" }), () => identity("administrator"), invoke);
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(calls).toEqual([[{ op: "install", version: "0.3.1" }, device]]);
});

test("authorization is checked again after reading a channel or version", async () => {
  let reads = 0, calls = 0;
  const response = await updateSettings(request("/api/updates/channel", { channel: "preview" }), () => ++reads === 1 ? identity("administrator") : null, async () => { calls++; return state; });
  expect(response.status).toBe(401);
  expect(calls).toBe(0);
});

test("playback must be explicitly interrupted at the server install boundary", async () => {
  const calls: UpdateAction[] = [];
  const invoke = async (action: UpdateAction) => { calls.push(action); return state; };
  const blocked = await updateSettings(request("/api/updates/install", { version: "0.3.1" }), () => identity("administrator"), invoke, () => [], { playing: () => true });
  expect(blocked.status).toBe(409);
  expect(await blocked.json()).toEqual({ error: UPDATE_INTERRUPTS_PLAYBACK, interruptionRequired: true });
  expect(calls).toEqual([]);
  const allowed = await updateSettings(request("/api/updates/install?interrupt=1", { version: "0.3.1" }), () => identity("administrator"), invoke, () => [], { playing: () => true });
  expect(allowed.status).toBe(200);
  expect(calls).toEqual([{ op: "install", version: "0.3.1", interrupt: true }]);
});

test("paired controllers can read release notes but cannot maintain media tools", async () => {
  let checks = 0;
  const helpers = { read: async () => ({ status: "idle" as const, checkedAt: null, items: [] }), check: async () => { checks++; return { status: "checking" as const, checkedAt: null, items: [] }; } };
  const services = { helpers, releases: async () => ({ releases: [], more: false }) };
  expect((await updateSettings(request("/api/updates/releases"), () => identity("controller"), undefined, undefined, services)).status).toBe(200);
  expect((await updateSettings(request("/api/updates/releases"), () => null, undefined, undefined, services)).status).toBe(401);
  expect((await updateSettings(request("/api/updates/helpers/check", {}), () => identity("controller"), undefined, undefined, services)).status).toBe(403);
  expect(checks).toBe(0);
  expect((await updateSettings(request("/api/updates/helpers/check", {}), () => identity("administrator"), undefined, undefined, services)).status).toBe(200);
  expect(checks).toBe(1);
});

test("malformed versions and target IDs never reach the native updater", async () => {
  let calls = 0;
  for (const [path, body] of [["/api/updates/install", { version: "0.3.1;reboot" }], ["/api/updates/channel", { channel: "nightly" }], ["/api/updates?device=unknown", undefined]] as const) {
    expect((await updateSettings(request(path, body), () => identity("administrator"), async () => { calls++; return state; })).status).toBe(400);
  }
  expect(calls).toBe(0);
});

test("native replies are correlated and validate untrusted client state", async () => {
  const sent: Array<{ id: string; action: UpdateAction }> = [];
  const updates = createNativeUpdates((id, action) => sent.push({ id, action }));
  const first = updates.request({ op: "read" }).catch(error => error as Error), second = updates.request({ op: "check" });
  updates.receive({ requestId: "stale", state });
  updates.receive({ requestId: sent[1]!.id, state });
  expect(await second).toEqual(state);
  updates.receive({ requestId: sent[0]!.id, state: { ...state, version: {} } as unknown as UpdateState });
  expect((await first).message).toBe("Invalid update reply.");
  const pending = updates.request({ op: "read" }).catch(error => error as Error);
  updates.close();
  expect((await pending).message).toBe("Couch is restarting.");
});

test("invalid automatic-update details cannot reach the remote settings page", async () => {
  let id = "";
  const updates = createNativeUpdates(next => { id = next; });
  const result = updates.request({ op: "read" }).catch(error => error as Error);
  updates.receive({ requestId: id, state: { ...state, automatic: { installed: true, active: false, last: { version: {}, at: 1, outcome: "failed", error: null } } } as unknown as UpdateState });
  expect((await result).message).toBe("Invalid update reply.");
});

test("malformed release strings in native replies cannot reach remote settings", async () => {
  let id = "";
  const updates = createNativeUpdates(next => { id = next; });
  for (const invalid of [
    { ...state, version: "" },
    { ...state, available: "0.3.1;reboot" },
    { ...state, channel: "nightly" },
    { ...state, status: "waiting" },
    { ...state, progress: NaN },
    { ...state, progress: 101 },
    { ...state, checkedAt: Infinity },
    { ...state, error: "x".repeat(4097) },
    { ...state, automatic: { installed: true, last: { version: "0.3.1", outcome: "skipped", at: 1, error: null, failed: "garbled" } } },
  ]) {
    const result = updates.request({ op: "read" }).catch(error => error as Error);
    updates.receive({ requestId: id, state: invalid as UpdateState });
    expect((await result as Error).message).toBe("Invalid update reply.");
  }
});

test("invalid actions are rejected before being sent to a connected native app", async () => {
  const sent: UpdateAction[] = [];
  const updates = createNativeUpdates((_id, action) => sent.push(action));
  for (const action of [null, { op: "install", version: "" }, { op: "channel", channel: "nightly" }]) {
    await expect(updates.request(action as UpdateAction)).rejects.toThrow();
  }
  expect(sent).toEqual([]);
});

test("older native replies can omit automatic details, timer activity and failed release", async () => {
  let id = "";
  const updates = createNativeUpdates(next => { id = next; });
  for (const reply of [state, { ...state, channel: "preview", available: "0.3.1-preview.2", automatic: { installed: true, last: { version: null, outcome: "waiting", at: 1, error: null } } }]) {
    const result = updates.request({ op: "read" });
    updates.receive({ requestId: id, state: reply as UpdateState });
    expect(await result).toEqual(reply);
  }
});

test("the TV status file and native reply boundary agree on every recorded outcome", async () => {
  let id = "";
  const updates = createNativeUpdates(next => { id = next; });
  for (const outcome of ["installed", "installed-unverified", "rolled-back", "failed", "skipped", "up-to-date", "waiting"]) {
    const last = parseUpdateOutcome(`at=2026-10-06T00:00:00Z\nversion=0.3.1-preview.2\noutcome=${outcome}\nerror=\nfailed=0.3.1-preview.1\n`);
    expect(last?.outcome).toBe(outcome);
    const reply = { ...state, automatic: { installed: true, active: true, last } };
    const result = updates.request({ op: "read" });
    updates.receive({ requestId: id, state: reply });
    expect(await result).toEqual(reply);
  }
  expect(parseUpdateOutcome("at=garbled\noutcome=waiting")).toBeNull();
  expect(parseUpdateOutcome("at=2026-10-06T00:00:00Z\noutcome=unknown")).toBeNull();
  const legacy = parseUpdateOutcome("at=2026-10-06T00:00:00Z\noutcome=waiting\nversion=\n");
  expect(legacy?.version).toBeNull();
  expect(legacy?.failed).toBeNull();
});
