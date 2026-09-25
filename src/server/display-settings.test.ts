import { expect, test } from "bun:test";
import { displaySettings } from "./display-settings";
import { createNativeDisplay } from "./display-native";
import type { ControllerIdentity } from "../shared/controllers";
import type { DisplayAction, DisplayState } from "../shared/display";

const state: DisplayState = { outputs: [], saved: null, current: null, notice: null, preview: null };
const admin = () => ({ authority: "administrator" }) as ControllerIdentity;
const request = (path: string, body?: unknown) => new Request(`http://localhost/api/display${path}`, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

test("the host and paired administrators can read or move native screens", async () => {
  let calls = 0;
  const invoke = async () => { calls++; return state; };
  for (const identity of [() => null, () => ({ authority: "controller" }) as ControllerIdentity]) {
    expect((await displaySettings(request(""), identity, invoke)).status).toBe(identity() ? 403 : 401);
    expect((await displaySettings(request("/preview", { output: "HDMI-1" }), identity, invoke)).status).toBe(identity() ? 403 : 401);
  }
  expect(calls).toBe(0);
  expect((await displaySettings(request(""), () => ({ authority: "host" }) as ControllerIdentity, invoke)).status).toBe(200);
});

test("display routes expose only read, preview, confirm and cancel operations", async () => {
  const actions: DisplayAction[] = [];
  const invoke = async (action: DisplayAction) => { actions.push(action); return state; };
  expect((await displaySettings(request(""), admin, invoke)).status).toBe(200);
  expect((await displaySettings(request("/preview", { output: "edid:abcd:HDMI-1" }), admin, invoke)).status).toBe(200);
  expect((await displaySettings(request("/confirm", { token: "preview-token" }), admin, invoke)).status).toBe(200);
  expect((await displaySettings(request("/cancel", { token: "preview-token" }), admin, invoke)).status).toBe(200);
  expect((await displaySettings(request("/execute", { command: "xrandr" }), admin, invoke)).status).toBe(404);
  expect((await displaySettings(request("/preview", { output: "x".repeat(4201) }), admin, invoke)).status).toBe(400);
  expect(actions).toEqual([{ op: "read" }, { op: "preview", output: "edid:abcd:HDMI-1" }, { op: "confirm", token: "preview-token" }, { op: "cancel", token: "preview-token" }]);
});

test("revoked access is checked again after reading the request body", async () => {
  let reads = 0;
  let called = false;
  const response = await displaySettings(request("/preview", { output: "HDMI-1" }), () => ++reads === 1 ? admin() : null, async () => { called = true; return state; });
  expect(response.status).toBe(401);
  expect(called).toBe(false);
});

test("missing native host and native errors stay truthful", async () => {
  expect((await displaySettings(request(""), admin)).status).toBe(503);
  const response = await displaySettings(request(""), admin, async () => { throw new Error("X11 did not report its outputs within two seconds."); });
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "X11 did not report its outputs within two seconds." });
});

test("private display replies require matching request IDs and reject overlap", async () => {
  let id = "";
  const native = createNativeDisplay(requestId => { id = requestId; });
  const pending = native.request({ op: "read" });
  native.receive({ requestId: "old", state });
  await expect(native.request({ op: "read" })).rejects.toThrow("pending");
  native.receive({ requestId: id, state });
  expect(await pending).toEqual(state);
  const failed = native.request({ op: "preview", output: "connector:HDMI-1" });
  native.receive({ requestId: id, error: "That screen is disconnected or disabled." });
  await expect(failed).rejects.toThrow("disconnected");
  const closed = native.request({ op: "read" });
  native.close();
  await expect(closed).rejects.toThrow("disconnected");
});
