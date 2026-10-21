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
const { SettingsIndex, SettingsNav } = await import("../src/client/sections/settings/SettingsNav");
const { SoundPage } = await import("../src/client/sections/settings/CouchPages");
const { HomeDiscoverPage } = await import("../src/client/sections/settings/ThisDevicePages");

const device = (id: string, name: string, role: "host" | "controller" | "administrator") => ({ id, name, role, createdAt: null, lastSeenAt: null });
function look(authority: "host" | "controller" | "administrator", details: object, status = "connected") {
  gate = {
    localHost: authority === "host", tvPresentation: false, status,
    identity: { authority, claimAvailable: false, device: authority === "host" ? device("tv", "Living room", "host") : device("phone", "Phone", authority) },
    state: { installationName: "Living room", devices: [] }, details: { name: "Living room", urls: [], player: "idle", ...details },
  };
}
/** The rail's groups: each heading, its muted line, and its pages (a locked one ends in "!"). */
function rail(authority: "host" | "controller" | "administrator", details: object, status?: string) {
  look(authority, details, status);
  const html = renderToStaticMarkup(<SettingsNav active="devices" />);
  return html.split('role="group"').slice(1).map(group => ({
    title: group.match(/<h2[^>]*>([^<]+)</)?.[1],
    subtitle: group.match(/<span class="truncate">([^<]+)</)?.[1],
    pages: [...group.matchAll(/data-settings-page="([^"]+)"[\s\S]*?<\/a>/g)].map(match => match[1] + (match[0].includes("only an admin") ? "!" : "")),
  }));
}

test("Settings names its two owners, and locks what a controller can't change", () => {
  expect(rail("controller", { systemAudio: true, tvPresentation: true, updates: true })).toEqual([
    { title: "This device", subtitle: "Phone", pages: ["device", "home"] },
    { title: "Living room", subtitle: "Connected", pages: ["devices", "playback", "sources", "sound!", "display!", "updates!"] },
  ]);
  expect(rail("administrator", {}, "reconnecting")[1]).toEqual({ title: "Living room", subtitle: "Reconnecting · admin", pages: ["devices", "playback", "sources"] });
  expect(rail("controller", {}, "server-unavailable")[1]?.subtitle).toBe("Offline");
});

test("On the host, the two owners are one Couch", () => {
  expect(rail("host", { systemAudio: true, updates: true })).toEqual([
    { title: "Living room", subtitle: "This computer runs it", pages: ["device", "home", "devices", "playback", "sources", "sound", "updates"] },
  ]);
  expect(rail("host", { tvPresentation: true })[0]?.subtitle).toBe("This TV runs it");
});

test("Below md, Settings lists both owners, and each page names its owner above its title", () => {
  look("controller", { systemAudio: true });
  const index = renderToStaticMarkup(<SettingsIndex />);
  expect([...index.matchAll(/<h2[^>]*>([^<]+)</g)].map(match => match[1])).toEqual(["This device", "Living room"]);
  const crumb = (html: string) => html.match(/aria-label="Settings path"[\s\S]*?<a[^>]*href="\/settings"[^>]*>([^<]+)</)?.[1];
  expect(crumb(renderToStaticMarkup(<HomeDiscoverPage />))).toBe("This device");
  expect(crumb(renderToStaticMarkup(<SoundPage />))).toBe("Living room");
  look("host", {});
  expect(crumb(renderToStaticMarkup(<HomeDiscoverPage />))).toBe("Living room");
});

test("A controller still sees what the Couch's Sound page holds, Bluetooth included", () => {
  look("controller", { systemAudio: true });
  const rows = (html: string) => [...html.slice(html.indexOf("data-settings-content")).matchAll(/data-slot="field-(?:label|legend)"[^>]*>([^<]+)</g)].map(match => match[1]);
  const html = renderToStaticMarkup(<SoundPage />);
  expect(rows(html)).toEqual(["Output", "Test &amp; delay", "Audio delay", "Test tone", "Bluetooth"]);
  expect(html).toContain("Only an admin can change this.");
});
