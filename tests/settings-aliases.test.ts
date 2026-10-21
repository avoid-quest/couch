import { expect, test } from "bun:test";

const { Route } = await import("../src/client/routes/settings/$");

function open(pathname: string) {
  try { Route.options.beforeLoad!({ location: { pathname } } as never); }
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
