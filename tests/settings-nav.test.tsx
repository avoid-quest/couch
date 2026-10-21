import { expect, mock, test } from "bun:test";
import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Links render as anchors; Settings navigation needs no router to show what it offers.
const router = await import("@tanstack/react-router");
mock.module("@tanstack/react-router", () => ({
  ...router,
  Link: ({ to, ...props }: ComponentProps<"a"> & { to: string }) => <a href={to} {...props} />,
  useNavigate: () => () => Promise.resolve(),
}));
let gate: object = {};
mock.module("../src/client/session/session-context", () => ({ useSessionGate: () => gate, useOptionalSessionGate: () => gate, errorText: String }));
mock.module("../src/client/sections/shell/AppShell", () => ({ useShell: () => ({ credentials: null }) }));
mock.module("../src/client/session/session", () => ({ createId: () => "id" }));
const { SettingsNav } = await import("../src/client/sections/settings/SettingsNav");
const { SoundPage, BluetoothPage } = await import("../src/client/sections/settings/CouchPages");

const device = (id: string, name: string, role: "host" | "controller" | "administrator") => ({ id, name, role, createdAt: null, lastSeenAt: null });
function rail(authority: "host" | "controller" | "administrator", details: object) {
  gate = {
    localHost: authority === "host", tvPresentation: false,
    identity: { authority, claimAvailable: false, device: authority === "host" ? device("tv", "Living room", "host") : device("phone", "Phone", authority) },
    state: { installationName: "Living room", devices: [] }, details: { name: "Living room", urls: [], player: "idle", ...details },
  };
  const html = renderToStaticMarkup(<SettingsNav active="network" />);
  const nav = html.slice(html.indexOf("<nav"));
  const scope = (id: string) => nav.split(`data-settings-scope="${id}"`)[1]!.split("data-settings-scope")[0]!;
  const pages = (id: string) => [...scope(id).matchAll(/data-settings-page="([^"]+)"/g)].map(match => match[1]);
  return { nav, device: pages("device"), couch: pages("couch") };
}

test("Settings names its two owners and still offers a controller every shared page", () => {
  const view = rail("controller", { systemAudio: true, tvPresentation: true, updates: true });
  expect(view.nav).toContain('aria-label="This device · Phone"');
  expect(view.nav).toContain('aria-label="Living room · Shared · Only admins change most"');
  expect(view.nav).toContain("Living room&#x27;s hardware");
  expect(view.device).toEqual(["general", "connection", "viewing", "home", "discover", "sharing"]);
  expect(view.couch).toEqual(["couch", "devices", "network", "playback", "sources", "sound", "bluetooth", "display", "updates"]);
});

test("Couch hardware follows what the Couch has, not who is looking", () => {
  expect(rail("administrator", {}).couch).toEqual(["couch", "devices", "network", "playback", "sources"]);
  const host = rail("host", { updates: true });
  expect(host.nav).toContain('aria-label="This device · Living room"');
  expect(host.nav).toContain("Shared · This device runs it");
  expect(host.couch.at(-1)).toBe("updates");
});

test("A controller still sees what the Couch's Sound and Bluetooth pages hold", () => {
  rail("controller", { systemAudio: true });
  const rows = (html: string) => [...html.slice(html.indexOf("data-settings-content")).matchAll(/data-slot="field-(?:label|legend)"[^>]*>([^<]+)</g)].map(match => match[1]);
  expect(rows(renderToStaticMarkup(<SoundPage />))).toEqual(["Output", "Test &amp; delay", "Audio delay", "Test tone"]);
  expect(rows(renderToStaticMarkup(<BluetoothPage />))).toEqual(["Add a device", "Devices"]);
  expect(renderToStaticMarkup(<BluetoothPage />)).toContain("Only an admin can change this.");
});
