import { expect, test } from "bun:test";

const { Route } = await import("../src/client/routes/settings/$");

function open(pathname: string) {
  try { Route.options.beforeLoad!({ location: { pathname } } as never); }
  catch (redirect) { return (redirect as { options: { href: string } }).options.href; }
}

test("earlier Settings addresses open the page that now holds them", () => {
  expect(open("/settings/device/updates")).toBe("/settings/updates");
  expect(open("/settings/couch/updates")).toBe("/settings/updates");
  expect(open("/settings/device/discover")).toBe("/settings/home");
  expect(open("/settings/couch/general")).toBe("/settings/devices");
  expect(open("/settings/couch/bluetooth")).toBe("/settings/sound");
  expect(open("/settings/couch/sources/radio")).toBe("/settings/sources/radio");
  expect(open("/settings/connection")).toBe("/settings/devices");
  expect(open("/settings/tv")).toBe("/settings/device");
});

test("an unknown address opens This device", () => {
  expect(open("/settings/nowhere")).toBe("/settings/device");
});
