import { expect, mock, test } from "bun:test";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { UpdateOutcome, UpdateState } from "../src/shared/app-bridge";
import { updateApp } from "../src/client/session/native-updates";

mock.module("../src/client/session/session-context", () => ({
  errorText: (error: unknown) => error instanceof Error ? error.message : String(error),
  useSessionGate: () => ({ credentials: { origin: "http://localhost", token: "test" }, identity: { authority: "administrator" }, connected: true, localHost: false }),
}));
mock.module("../src/client/sections/settings/SettingsLayout", () => ({
  SettingsLayout: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
mock.module("../src/client/sections/settings/settings-scope", () => ({
  useSettingsScope: () => ({ device: "Phone", couch: "Living room TV", host: false, administrator: true, known: true }),
}));
const { UpdatesPage } = await import("../src/client/sections/settings/app/UpdatesPage");
const { UpdateCenterProvider } = await import("../src/client/session/update-center");

function renderState(state: UpdateState, others: { id: string; name: string; state: UpdateState }[] = []) {
  const client = new QueryClient();
  client.setQueryData(["updates", "targets"], [{ id: "host", name: "Living room TV", tv: true }, ...others.map(({ id, name }) => ({ id, name, tv: false }))]);
  client.setQueryData(["updates", "host"], state);
  for (const other of others) client.setQueryData(["updates", other.id], other.state);
  const html = renderToStaticMarkup(<QueryClientProvider client={client}><UpdateCenterProvider><UpdatesPage /></UpdateCenterProvider></QueryClientProvider>);
  client.clear();
  return html;
}

function page(outcome: UpdateOutcome["outcome"]) {
  const state: UpdateState = { version: "0.3.0", channel: "latest", status: "ready", available: "0.3.1", progress: null, checkedAt: 1, error: null,
    automatic: { installed: true, active: true, last: { version: "0.3.1", outcome, at: 1, error: null, failed: outcome === "skipped" ? "0.3.1" : null } } };
  return renderState(state).replace(/<[^>]+>/g, "");
}

test("the Updates page explains why automatic updates wait during playback", () => {
  expect(page("waiting")).toContain("Waiting while media is playing");
});

test("the Updates page names the known failed release automatic updates skipped", () => {
  const html = page("skipped");
  expect(html).toContain("Skipped Couch 0.3.1");
  expect(html).toContain("failed");
});

test("the Updates page distinguishes an up-to-date automatic check", () => {
  expect(page("up-to-date")).toContain("Up to date. Checked");
});

test.each([
  "Couldn't install the update. Try again later.",
  "This TV can't install updates yet. Run sudo couch-setup --tv once.",
])("the Updates controls show a legacy install failure with enabled retry: %s", async error => {
  let state: UpdateState = { version: "0.3.0", channel: "latest", status: "ready", available: "0.3.1", progress: null, checkedAt: 1, error: null };
  const bridge = {
    updates: async () => state,
    checkForUpdates: async () => state,
    setUpdateChannel: async () => state,
    installUpdate: async () => { state = { ...state, error }; },
  };
  const html = renderState(await updateApp(bridge, { op: "install", version: "0.3.1" }));
  expect(html).toContain(renderToStaticMarkup(error));
  expect(html).toContain("0.3.0 to 0.3.1");
  const retry = html.match(/<button\b[^>]*>Update Living room TV<\/button>/)?.[0];
  expect(retry).toBeDefined();
  expect(retry).not.toMatch(/\sdisabled(?:=|[\s>])/);
});

test("one device's channel is its Channel row; several are named under Channels", () => {
  const state: UpdateState = { version: "0.3.0", channel: "latest", status: "up-to-date", available: null, progress: null, checkedAt: 1, error: null };
  const labels = (html: string) => [...html.matchAll(/<legend[^>]*>([^<]+)<|for="update-channel-[^"]+"[^>]*>([^<]+)</g)].map(match => match[1] ?? match[2]);
  expect(labels(renderState(state))).toEqual(["Channel"]);
  expect(labels(renderState(state, [{ id: "laptop", name: "Laptop", state: { ...state, channel: "preview" } }]))).toEqual(["Channels", "Living room TV", "Laptop"]);
});
