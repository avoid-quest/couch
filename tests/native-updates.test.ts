import { expect, test } from "bun:test";
import { updateApp } from "../src/client/session/native-updates";
import type { CouchApp, UpdateAction, UpdateState } from "../src/shared/app-bridge";

const state: UpdateState = { version: "0.3.0", channel: "latest", status: "ready", available: "0.3.1", progress: null, checkedAt: null, error: null };

function bridge() {
  const calls: unknown[] = [];
  let current = state;
  const app: Pick<CouchApp, "update" | "updates" | "checkForUpdates" | "setUpdateChannel" | "installUpdate"> = {
    async updates() { calls.push("read"); return current; },
    async checkForUpdates() { calls.push("check"); return state; },
    async setUpdateChannel(channel) { calls.push(["channel", channel]); return { ...state, channel }; },
    async installUpdate(version) { calls.push(["install", version]); current = { ...state, status: "installing" }; },
  };
  return { app, calls };
}

test("new native bridges receive the version shown when Restart to update was clicked", async () => {
  const { app, calls } = bridge();
  app.update = async action => { calls.push(action); return { ...state, status: "installing" }; };
  expect((await updateApp(app, { op: "install", version: "0.3.1" })).status).toBe("installing");
  expect(calls).toEqual([{ op: "install", version: "0.3.1" }]);
});

test("older bridges retain reads, checks, channel changes and a checked install fallback", async () => {
  const { app, calls } = bridge();
  expect(await updateApp(app, { op: "read" })).toEqual(state);
  await updateApp(app, { op: "check" });
  expect((await updateApp(app, { op: "channel", channel: "preview" })).channel).toBe("preview");
  expect((await updateApp(app, { op: "install", version: "0.3.1" })).status).toBe("installing");
  expect(calls).toEqual(["read", "check", ["channel", "preview"], "read", ["install", "0.3.1"], "read"]);
});

test.each([
  "Couldn't install the update. Try again later.",
  "This TV can't install updates yet. Run sudo couch-setup --tv once.",
])("older bridges preserve the native install error and allow retry: %s", async error => {
  const { app, calls } = bridge();
  let current = state;
  let displayed = state;
  app.updates = async () => { calls.push("read"); return current; };
  app.installUpdate = async version => {
    calls.push(["install", version]);
    // Legacy native installers emit Ready/error and still resolve Promise<void>.
    current = { ...state, error };
    displayed = current;
  };
  displayed = await updateApp(app, { op: "install", version: "0.3.1" });
  expect(displayed).toEqual(current);
  expect(displayed.status).toBe("ready");
  expect(displayed.error).toBe(error);
  expect(calls).toEqual(["read", ["install", "0.3.1"], "read"]);
  await updateApp(app, { op: "install", version: displayed.available! });
  expect(calls).toEqual(["read", ["install", "0.3.1"], "read", "read", ["install", "0.3.1"], "read"]);
});

test("older bridges cannot install a release that changed or is being checked", async () => {
  for (const next of [{ ...state, available: "0.3.2" }, { ...state, status: "checking" as const }]) {
    const { app, calls } = bridge();
    app.updates = async () => next;
    await expect(updateApp(app, { op: "install", version: "0.3.1" })).rejects.toThrow("available update changed");
    expect(calls).toEqual([]);
  }
});

test("malformed actions never reach either native bridge generation", async () => {
  const { app, calls } = bridge();
  app.update = async action => { calls.push(action); return state; };
  for (const action of [null, [], { op: "quit" }, { op: "channel", channel: "nightly" }, { op: "install" }, { op: "install", version: "" }, { op: "install", version: "0.3.1;reboot" }]) {
    await expect(updateApp(app, action as UpdateAction)).rejects.toThrow();
  }
  expect(calls).toEqual([]);
});
