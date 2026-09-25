import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ControllerIdentity } from "../shared/controllers";
import { streamingCommunityOrigin } from "../shared/streamingcommunity";
import { createStreamingCommunitySettings } from "./streamingcommunity-settings";
import { openStore } from "./store";

const cleanups: (() => void)[] = [];
afterEach(() => { for (const close of cleanups.splice(0).reverse()) close(); });
function fixture(path = ":memory:") {
  const store = openStore(path); cleanups.push(() => store.close());
  const settings = createStreamingCommunitySettings(store);
  let authority: ControllerIdentity["authority"] | null = "administrator";
  const identity = (): ControllerIdentity | null => authority ? { authority, controller: null, claimAvailable: false } : null;
  const request = (body?: unknown) => new Request("http://localhost/api/settings/streamingcommunity", body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { store, settings, identity, request, send: (body?: unknown) => settings.handle(request(body), identity), authority: (next: typeof authority) => { authority = next; } };
}

test("saves one origin across reopen while retaining queue, devices and installation", async () => {
  const directory = mkdtempSync(join(tmpdir(), "couch-sc-settings-")); cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "couch.sqlite"), first = fixture(path);
  const token = first.store.pair("Phone"); first.store.renameInstallation("Living room");
  expect(await (await first.send()).json()).toEqual({ origin: streamingCommunityOrigin });
  const response = await first.send({ origin: "https://streamingcommunity.example" });
  expect(response.status).toBe(200); expect(response.headers.get("Cache-Control")).toBe("no-store");
  const second = fixture(path);
  expect(second.store.streamingCommunityOrigin()).toBe("https://streamingcommunity.example");
  expect(second.store.installationName()).toBe("Living room"); expect(second.store.controllerForToken(token)?.name).toBe("Phone");
  expect(second.store.queue).toEqual(first.store.queue);
});

test("updates the previous default origin while preserving custom origins", () => {
  const directory = mkdtempSync(join(tmpdir(), "couch-sc-origin-")); cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "couch.sqlite"), first = fixture(path);
  first.store.saveStreamingCommunityOrigin("https://streamingcommunityz.academy");
  const second = fixture(path);
  expect(second.store.streamingCommunityOrigin()).toBe("https://streamingcommunityz.photos");
  second.store.saveStreamingCommunityOrigin("https://streamingcommunity.example");
  expect(fixture(path).store.streamingCommunityOrigin()).toBe("https://streamingcommunity.example");
});

test("rejects controller writes, malformed origins, credentials and demotion during body read", async () => {
  const f = fixture();
  for (const authority of ["controller", null] as const) {
    f.authority(authority);
    expect((await f.send()).status).toBe(authority ? 403 : 401);
    expect((await f.send({ origin: "https://streamingcommunity.example" })).status).toBe(authority ? 403 : 401);
  }
  f.authority("administrator");
  for (const origin of ["http://streamingcommunity.example", "https://streamingcommunity.example/", "https://streamingcommunity.example/path", "https://streamingcommunity.example?token=secret", "https://user:secret@streamingcommunity.example", "https://streamingcommunity.example:443", "https://example.com", "https://streamingcommunity_example.com", null]) expect((await f.send({ origin })).status).toBe(400);
  const request = new Request("http://localhost/api/settings/streamingcommunity", { method: "POST", headers: { "Content-Type": "application/json" }, body: new ReadableStream({ pull(controller) { f.authority("controller"); controller.enqueue(new TextEncoder().encode(JSON.stringify({ origin: "https://streamingcommunity.example" }))); controller.close(); } }) });
  expect((await f.settings.handle(request, f.identity)).status).toBe(403);
  expect(f.store.streamingCommunityOrigin()).toBe(streamingCommunityOrigin);
  f.authority("host"); expect((await f.send({ origin: "https://streamingcommunity.example" })).status).toBe(200);
});
