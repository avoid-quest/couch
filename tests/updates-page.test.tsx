import { expect, mock, test } from "bun:test";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { UpdateOutcome, UpdateState } from "../src/shared/app-bridge";

mock.module("../src/client/session/session-context", () => ({
  useSessionGate: () => ({ credentials: { origin: "http://localhost", token: "test" }, identity: { authority: "administrator" }, connected: true, localHost: false }),
}));
mock.module("../src/client/sections/settings/SettingsLayout", () => ({
  SettingsLayout: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
const { UpdatesPage } = await import("../src/client/sections/settings/app/UpdatesPage");

function page(outcome: UpdateOutcome["outcome"]) {
  const client = new QueryClient();
  client.setQueryData(["updates", "targets"], [{ id: "host", name: "Living room TV", tv: true }]);
  const state: UpdateState = { version: "0.3.0", channel: "latest", status: "ready", available: "0.3.1", progress: null, checkedAt: 1, error: null,
    automatic: { installed: true, active: true, last: { version: "0.3.1", outcome, at: 1, error: null, failed: outcome === "skipped" ? "0.3.1" : null } } };
  client.setQueryData(["updates", "host"], state);
  const html = renderToStaticMarkup(<QueryClientProvider client={client}><UpdatesPage /></QueryClientProvider>);
  client.clear();
  return html.replace(/<[^>]+>/g, "");
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
