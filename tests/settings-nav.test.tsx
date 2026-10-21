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
const { SoundPage } = await import("../src/client/sections/settings/CouchPages");

const device = (id: string, name: string, role: "host" | "controller" | "administrator") => ({ id, name, role, createdAt: null, lastSeenAt: null });
function rail(authority: "host" | "controller" | "administrator", details: object) {
  gate = {
    localHost: authority === "host", tvPresentation: false,
    identity: { authority, claimAvailable: false, device: authority === "host" ? device("tv", "Living room", "host") : device("phone", "Phone", authority) },
    state: { installationName: "Living room", devices: [] }, details: { name: "Living room", urls: [], player: "idle", ...details },
  };
  const html = renderToStaticMarkup(<SettingsNav active="devices" />);
  const nav = html.slice(html.indexOf("<nav"));
  return [...nav.matchAll(/data-settings-page="([^"]+)"/g)].map(match => match[1]);
}

test("Settings is one plain list that still offers a controller every shared page", () => {
  expect(rail("controller", { systemAudio: true, tvPresentation: true, updates: true })).toEqual(["device", "home", "devices", "playback", "sources", "sound", "display", "updates"]);
});

test("Couch hardware follows what the Couch has, not who is looking", () => {
  expect(rail("administrator", {})).toEqual(["device", "home", "devices", "playback", "sources"]);
  expect(rail("host", { updates: true }).at(-1)).toBe("updates");
  expect(rail("host", { tvModeChangeable: true })).toContain("display");
});

test("A controller still sees what the Couch's Sound page holds, Bluetooth included", () => {
  rail("controller", { systemAudio: true });
  const rows = (html: string) => [...html.slice(html.indexOf("data-settings-content")).matchAll(/data-slot="field-(?:label|legend)"[^>]*>([^<]+)</g)].map(match => match[1]);
  const html = renderToStaticMarkup(<SoundPage />);
  expect(rows(html)).toEqual(["Output", "Test &amp; delay", "Audio delay", "Test tone", "Bluetooth"]);
  expect(html).toContain("Only an admin can change this.");
});
