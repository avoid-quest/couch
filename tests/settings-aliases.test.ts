import { expect, mock, test } from "bun:test";
import type { DeviceIdentity } from "../src/shared/devices";

// A browser has no app updater, as if it had no bridge.
const app: { updates?: () => void } = {};
const native = await import("../src/client/session/native-context");
mock.module("../src/client/session/native-context", () => ({ ...native, couchApp: app }));
const { Route } = await import("../src/client/routes/settings/$");

// The old Updates address opens before this app's identity arrives, as on a cold start.
function open(pathname: string, native: "local" | "remote" | null, identity: Pick<DeviceIdentity, "authority"> | null = null) {
  app.updates = native ? () => {} : undefined;
  try { Route.options.beforeLoad!({ location: { pathname }, context: { identity, localHost: native === "local" } } as never); }
  catch (redirect) { return (redirect as { options: { href: string } }).options.href; }
}

test("the old Updates address opens the Couch's updater on the app that hosts it, even before its identity", () => {
  expect(open("/settings/updates", "local")).toBe("/settings/couch/updates");
  expect(open("/settings/updates", "local", { authority: "host" })).toBe("/settings/couch/updates");
});

test("the old Updates address opens this app's own updater in Client mode, and the Couch's in a browser", () => {
  expect(open("/settings/updates", "remote")).toBe("/settings/device/updates");
  expect(open("/settings/updates", "remote", { authority: "administrator" })).toBe("/settings/device/updates");
  expect(open("/settings/updates", null)).toBe("/settings/couch/updates");
});

test("other old addresses need no identity", () => {
  expect(open("/settings/connection", "remote")).toBe("/settings/couch/devices");
  expect(open("/settings/nowhere", null)).toBe("/settings/device/general");
});
