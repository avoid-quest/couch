import { expect, mock, test } from "bun:test";
import type { DeviceIdentity } from "../src/shared/devices";

// A browser has no app updater, as if it had no bridge.
const app: { updates?: () => void } = {};
const native = await import("../src/client/session/native-context");
mock.module("../src/client/session/native-context", () => ({ ...native, couchApp: app }));
const { Route } = await import("../src/client/routes/settings/$");

function open(pathname: string) {
  app.updates = undefined;
  try { Route.options.beforeLoad!({ location: { pathname } } as never); }
  catch (redirect) { return (redirect as { options: { href: string } }).options.href; }
}

// The old Updates address opens before this app's identity arrives, as on a cold start.
function openIn(pathname: string, native: "local" | "remote", identity: Pick<DeviceIdentity, "authority"> | null = null) {
  app.updates = () => {};
  try { Route.options.beforeLoad!({ location: { pathname }, context: { identity, localHost: native === "local" } } as never); }
  catch (redirect) { return (redirect as { options: { href: string } }).options.href; }
}

test("main's addresses and the flat ones open the page that now holds them", () => {
  expect(open("/settings/home")).toBe("/settings/device/home");
  expect(open("/settings/device/discover")).toBe("/settings/device/home");
  expect(open("/settings/devices")).toBe("/settings/couch/devices");
  expect(open("/settings/couch/general")).toBe("/settings/couch/devices");
  expect(open("/settings/connection")).toBe("/settings/couch/devices");
  expect(open("/settings/playback")).toBe("/settings/couch/playback");
  expect(open("/settings/sources/radio")).toBe("/settings/couch/sources/radio");
  expect(open("/settings/sound")).toBe("/settings/couch/sound");
  expect(open("/settings/couch/bluetooth")).toBe("/settings/couch/sound");
  expect(open("/settings/display")).toBe("/settings/couch/tv");
  expect(open("/settings/couch/display")).toBe("/settings/couch/tv");
  expect(open("/settings/updates")).toBe("/settings/couch/updates");
  expect(open("/settings/tv")).toBe("/settings/device");
  expect(open("/settings/device/general")).toBe("/settings/device");
});

test("an unknown address opens This device", () => {
  expect(open("/settings/nowhere")).toBe("/settings/device");
});

test("the old Updates address opens an admin's Couch updates, on the host even before its identity", () => {
  expect(openIn("/settings/updates", "local")).toBe("/settings/couch/updates");
  expect(openIn("/settings/updates", "local", { authority: "host" })).toBe("/settings/couch/updates");
  expect(openIn("/settings/updates", "remote", { authority: "administrator" })).toBe("/settings/couch/updates");
});

test("the old Updates address opens this app's own updater for anyone else, and the page corrects it once the role arrives", () => {
  expect(openIn("/settings/updates", "remote")).toBe("/settings/device/updates");
  expect(openIn("/settings/updates", "remote", { authority: "controller" })).toBe("/settings/device/updates");
  expect(openIn("/settings/connection", "remote")).toBe("/settings/couch/devices");
});
