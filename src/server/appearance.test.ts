import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TvAppearance } from "../shared/appearance";
import type { ControllerIdentity } from "../shared/controllers";
import { createAppearance } from "./appearance";
import { openStore } from "./store";

const cleanup: (() => void)[] = [];
afterEach(() => { for (const close of cleanup.splice(0).reverse()) close(); });

function fixture(file = ":memory:") {
  const store = openStore(file);
  const publish = mock((_state: TvAppearance) => {});
  const service = createAppearance(store, publish);
  cleanup.push(() => { service.close(); store.close(); });
  let authority: ControllerIdentity["authority"] | null = "administrator";
  const identity = (): ControllerIdentity | null => authority ? { authority, controller: null, claimAvailable: false } : null;
  const request = (path = "", input?: unknown, method = input === undefined ? "GET" : "POST") => service.handle(new Request(`http://localhost/api/appearance${path}`, {
    method, ...(input === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }),
  }), identity);
  const state = async () => await (await request()).json() as TvAppearance;
  return { store, publish, service, identity, request, state, authority: (value: typeof authority) => { authority = value; } };
}

test("preview publishes immediately, confirmation persists only the selected size, and reset is immediate", async () => {
  const directory = mkdtempSync(join(tmpdir(), "couch-appearance-"));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, "couch.sqlite");
  const f = fixture(file);
  f.store.renameInstallation("Living room");
  const token = f.store.pair("Existing remote");
  expect(await f.state()).toEqual({ size: 1, confirmedSize: 1, preview: null });
  const before = Date.now();
  const response = await f.request("", { size: 1.3 });
  const preview = await response.json() as TvAppearance;
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(structuredClone(preview)).toMatchObject({ size: 1.3, confirmedSize: 1, preview: { id: expect.any(String) } });
  expect(preview.preview!.expiresAt).toBeGreaterThanOrEqual(before + 20_000);
  expect(f.publish).toHaveBeenLastCalledWith(preview);
  const second = fixture(file);
  expect(await second.state()).toEqual({ size: 1, confirmedSize: 1, preview: null });
  expect((await f.request("/confirm", { previewId: preview.preview!.id })).status).toBe(200);
  expect(await second.state()).toEqual({ size: 1.3, confirmedSize: 1.3, preview: null });
  expect((await f.request("/reset", { size: 1 })).status).toBe(200);
  expect(await f.state()).toEqual({ size: 1, confirmedSize: 1, preview: null });
  expect(second.store.installationName()).toBe("Living room");
  expect(second.store.controllerForToken(token)?.name).toBe("Existing remote");
});

test("cancel, expired confirmation and replacement previews preserve the saved size", async () => {
  const f = fixture();
  f.store.saveTvInterfaceSize(1.15);
  const first = await (await f.request("", { size: 1.3 })).json() as TvAppearance;
  const second = await (await f.request("", { size: 1 })).json() as TvAppearance;
  expect((await f.request("/confirm", { previewId: first.preview!.id })).status).toBe(409);
  expect((await f.request("/cancel", { previewId: second.preview!.id })).status).toBe(200);
  expect(await f.state()).toEqual({ size: 1.15, confirmedSize: 1.15, preview: null });
  const third = await (await f.request("", { size: 1.3 })).json() as TvAppearance;
  const time = spyOn(Date, "now").mockReturnValue(third.preview!.expiresAt);
  try {
    expect((await f.request("/confirm", { previewId: third.preview!.id })).status).toBe(409);
    expect(await f.state()).toEqual({ size: 1.15, confirmedSize: 1.15, preview: null });
  } finally { time.mockRestore(); }
});

test("ordinary remotes can read TV size but only current administrators and physical hosts may change it", async () => {
  const f = fixture();
  const preview = await (await f.request("", { size: 1.3 })).json() as TvAppearance;
  for (const authority of ["controller", null] as const) {
    f.authority(authority);
    expect((await f.request()).status).toBe(authority ? 200 : 401);
    for (const [path, input] of [["", { size: 1.15 }], ["/confirm", { previewId: preview.preview!.id }], ["/cancel", { previewId: preview.preview!.id }], ["/reset", { size: 1 }]] as const) {
      expect((await f.request(path, input)).status).toBe(authority ? 403 : 401);
    }
  }
  expect(f.store.tvInterfaceSize()).toBe(1);
  f.authority("host");
  expect((await f.request("/reset", { size: 1 })).status).toBe(200);
});

test("revocation or demotion while reading any mutation body prevents the write", async () => {
  for (const authority of [null, "controller"] as const) {
    for (const path of ["", "/confirm", "/cancel", "/reset"]) {
      const f = fixture();
      const preview = await (await f.request("", { size: 1.3 })).json() as TvAppearance;
      const changed = f.publish.mock.calls.length;
      let finish!: (value: Uint8Array) => void;
      const stream = new ReadableStream({ start(controller) { finish = value => { controller.enqueue(value); controller.close(); }; } });
      const pending = f.service.handle(new Request(`http://localhost/api/appearance${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: stream }), f.identity);
      f.authority(authority);
      finish(new TextEncoder().encode(JSON.stringify(path === "" || path === "/reset" ? { size: 1 } : { previewId: preview.preview!.id })));
      expect((await pending).status).toBe(authority ? 403 : 401);
      expect(f.store.tvInterfaceSize()).toBe(1);
      expect(f.publish.mock.calls.length).toBe(changed);
    }
  }
});

test("reject unsupported, coerced, extra-field, oversized and malformed settings without publishing", async () => {
  const f = fixture();
  for (const size of [0, -1, 100, 1.2, "1.3", [1.3], {}, null, true]) expect((await f.request("", { size })).status).toBe(400);
  for (const input of [[], null, { size: 1, extra: true }, {}, { size: "x".repeat(9000) }]) expect((await f.request("", input)).status).toBe(input && !Array.isArray(input) && "size" in input && typeof input.size === "string" ? 413 : 400);
  expect((await f.request("/reset", { size: 1.3 })).status).toBe(400);
  expect((await f.request("/confirm", { previewId: ["bad"] })).status).toBe(409);
  expect((await f.service.handle(new Request("http://localhost/api/appearance", { method: "POST", body: "{}" }), f.identity)).status).toBe(415);
  expect((await f.service.handle(new Request("http://localhost/api/appearance", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" }), f.identity)).status).toBe(400);
  expect((await f.request("/missing")).status).toBe(404);
  expect((await f.request("/confirm")).status).toBe(405);
  expect(f.publish).not.toHaveBeenCalled();
  expect(f.store.tvInterfaceSize()).toBe(1);
});

test("failed persistence leaves the preview reversible and does not leak database errors", async () => {
  const directory = mkdtempSync(join(tmpdir(), "couch-appearance-failure-"));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, "couch.sqlite");
  const f = fixture(file);
  const preview = await (await f.request("", { size: 1.3 })).json() as TvAppearance;
  const db = new Database(file);
  db.run("CREATE TRIGGER reject_scale BEFORE UPDATE ON installation_appearance BEGIN SELECT RAISE(ABORT, 'PRIVATE path'); END;");
  db.close();
  const response = await f.request("/confirm", { previewId: preview.preview!.id });
  expect(response.status).toBe(500);
  expect(await response.text()).not.toContain("PRIVATE");
  expect(await f.state()).toEqual(preview);
  expect((await f.request("/cancel", { previewId: preview.preview!.id })).status).toBe(200);
  expect(await f.state()).toEqual({ size: 1, confirmedSize: 1, preview: null });
});
