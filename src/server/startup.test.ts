import { expect, test } from "bun:test";
import { createStartup, startupEnabled, startupBootReady } from "./startup";
import type { ControllerIdentity } from "../shared/controllers";

const config = `   [Seat:seat0]\nA  autologin-user=couch-tv\nA  autologin-session=couch\nA  autologin-user-timeout=0\n\n   [Seat:*]\nB  autologin-user=administrator\n\nSources:\nA  /usr/share/lightdm/lightdm.conf.d/50-couch.conf\nB  /etc/lightdm/lightdm.conf.d/90-override.conf\n`;
const admin = () => ({ authority: "administrator" }) as ControllerIdentity;
const request = (value?: unknown) => new Request("http://localhost/api/settings/startup", value === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });

test("LightDM readback resolves defaults before ordered matching seat groups, including numeric source IDs", () => {
  expect(startupEnabled(config)).toBe(true);
  expect(startupEnabled(config.replace("A  autologin-user=couch-tv", "27  autologin-user="))).toBe(false);
  expect(startupEnabled(config.replace("Sources:", "   [Seat:seat?]\n27  autologin-user=\nSources:"))).toBe(false);
  expect(startupEnabled(config.replace("Sources:", "   [Seat:other*]\nA  autologin-user=\nSources:"))).toBe(true);
  expect(() => startupEnabled(config.replace("autologin-session=couch", "autologin-session=ubuntu"))).toThrow("conflicting");
  expect(() => startupEnabled(config.replace("Sources:", "   [LightDM]\nA  start-default-seat=false\nSources:"))).toThrow("not to start");
  expect(() => startupEnabled("unreadable configuration")).toThrow("no readable");
});

test("startup writes require current administrator authority, a boolean and exact request fields", async () => {
  let writes = 0;
  const settings = createStartup(async () => true, { read: async () => true, write: async () => { writes++; }, fullscreen: async () => true });
  for (const authority of ["host", "controller"] as const) expect((await settings.handle(request({ enabled: false }), () => ({ authority }) as ControllerIdentity)).status).toBe(403);
  for (const value of [{ enabled: "false" }, { enabled: false, unit: "dbus.service" }]) expect((await settings.handle(request(value), admin)).status).toBe(400);
  let authorizationCalls = 0;
  expect((await settings.handle(request({ enabled: false }), () => ++authorizationCalls === 1 ? admin() : null)).status).toBe(403);
  expect(writes).toBe(0);
});

test("OS rejection and effective override never claim success; successful write reads back OS state", async () => {
  let effective = true;
  let override = true;
  let reject = false;
  const settings = createStartup(async () => false, { read: async () => effective, write: async enabled => { if (reject) throw new Error("OS permission denied. Inspect couch-autostart logs."); if (!override) effective = enabled; }, fullscreen: async () => false });
  const overridden = await settings.handle(request({ enabled: false }), admin);
  expect(overridden.status).toBe(503);
  expect((await overridden.json()).error).toContain("overridden");
  reject = true;
  expect((await (await settings.handle(request({ enabled: false }), admin)).json()).error).toContain("permission denied");
  reject = override = false;
  const saved = await settings.handle(request({ enabled: false }), admin);
  expect(saved.status).toBe(200);
  expect(await saved.json()).toEqual({ enabled: false, fullscreenAtLaunch: true, fullscreenNow: false, applies: "next-session" });
});

test("concurrent startup mutations reject and failed writes release admission", async () => {
  let finish!: () => void;
  const blocked = new Promise<void>(resolve => { finish = resolve; });
  const settings = createStartup(async () => null, { read: async () => true, write: () => blocked, fullscreen: async () => null });
  const first = settings.handle(request({ enabled: true }), admin);
  await Bun.sleep(0);
  expect((await settings.handle(request({ enabled: true }), admin)).status).toBe(409);
  finish();
  expect((await first).status).toBe(200);
  expect((await settings.handle(request({ enabled: true }), admin)).status).toBe(200);
});

test("Ubuntu LightDM indirect alias is valid; masked, disabled and nongraphical boot are unavailable", () => {
  for (const state of ["enabled", "indirect"]) expect(startupBootReady(`LoadState=loaded\nUnitFileState=${state}\n`, "graphical.target\n", "lightdm.service\n")).toBe(true);
  for (const state of ["masked", "masked-runtime", "disabled", "enabled-runtime"]) expect(startupBootReady(`LoadState=loaded\nUnitFileState=${state}\n`, "graphical.target", "lightdm.service")).toBe(false);
  expect(startupBootReady("LoadState=loaded\nUnitFileState=indirect", "multi-user.target", "lightdm.service")).toBe(false);
  expect(startupBootReady("LoadState=loaded\nUnitFileState=indirect", "graphical.target", "display-manager.service")).toBe(false);
});
