import { expect, test } from "bun:test";
import { updateSettings } from "../src/server/updates-settings";
import { createNativeUpdates } from "../src/server/updates-native";
import type { UpdateAction, UpdateState } from "../src/shared/app-bridge";
import type { DeviceIdentity } from "../src/shared/devices";

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
