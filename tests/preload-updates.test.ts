import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import type { CouchApp, UpdateState } from "../src/shared/app-bridge";

test("the real preload routes versioned installs and legacy renderer methods to Main", async () => {
  const result = await Bun.build({ entrypoints: ["app/preload.ts"], target: "node", format: "cjs", external: ["electron"] });
  expect(result.success).toBe(true);
  const calls: unknown[] = [];
  const state: UpdateState = { version: "0.3.0", channel: "latest", status: "ready", available: "0.3.1", progress: null, checkedAt: null, error: null };
  let app: CouchApp | undefined;
  const electron = {
    contextBridge: { exposeInMainWorld(name: string, bridge: CouchApp) { expect(name).toBe("couchApp"); app = bridge; } },
    ipcRenderer: { async invoke(...args: unknown[]) { calls.push(args); return { value: state }; }, on() {}, off() {} },
  };
  runInNewContext(await result.outputs[0]!.text(), { require: () => electron, process: { platform: "linux", argv: [] } });
  expect(await app!.updates()).toEqual(state);
  await app!.checkForUpdates();
  await app!.setUpdateChannel("preview");
  expect(await app!.installUpdate("0.3.1")).toBeUndefined();
  expect(await app!.installUpdate()).toBeUndefined();
  expect(calls).toEqual([
    ["couch:update-action", { op: "read" }],
    ["couch:update-action", { op: "check" }],
    ["couch:update-action", { op: "channel", channel: "preview" }],
    ["couch:update-action", { op: "install", version: "0.3.1" }],
    ["couch:install-update"],
  ]);
});
