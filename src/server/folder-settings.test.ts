import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ControllerIdentity } from "../shared/controllers";
import type { ManagedFolder } from "../shared/folders";
import { ControllerError } from "./controllers";
import { createFolderSettings } from "./folder-settings";
import { createMediaFolders, FolderError } from "./media-folders";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()!(); });
const administrator: ControllerIdentity = { authority: "administrator", controller: { id: "admin", name: "Phone", role: "administrator", createdAt: null, lastSeenAt: null }, claimAvailable: false };
const request = (path: string, method = "GET", value?: unknown) => new Request(`http://couch${path}`, {
  method, ...(value === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) }),
});

async function setup(mountInfo: () => Promise<string | null> = async () => null) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "couch-folder-settings-")));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const media = join(root, "Movies");
  await mkdir(media);
  const sources: ManagedFolder[] = [{ id: "saved", name: "Movies", path: media, status: "ready", error: null, warning: null, lastScanned: 1, itemCount: 2, scannedItems: 2, verified: true }];
  const changes: string[] = [];
  const folders = createMediaFolders({ roots: [root], mountInfo });
  const library = {
    managedSources: () => sources,
    async addSource(path: string, authorize: () => void) {
      authorize();
      if (sources.some(source => source.path === path)) throw new FolderError("This folder is already a source.", 409);
      changes.push(`add:${path}`);
    },
    scan(id: string, authorize: () => void) { authorize(); changes.push(`scan:${id}`); return Promise.resolve(sources[0]); },
    async testSource(id: string, authorize: () => void, confirm = false) { authorize(); changes.push(`${confirm ? "verify" : "test"}:${id}`); return sources[0]; },
    removeSource(id: string, authorize: () => void) { authorize(); changes.push(`remove:${id}`); },
  };
  return { root, media, sources, changes, settings: createFolderSettings(library, folders) };
}

test("unpaired and ordinary controllers cannot read protected paths or mutate folders", async () => {
  const { settings, media, changes } = await setup();
  const operations = [
    request("/api/library/folders"), request("/api/library/folders/browse"),
    request("/api/library/sources", "POST", { path: media }), request("/api/library/sources/saved/scan", "POST"),
    request("/api/library/sources/saved/test", "POST"), request("/api/library/sources/saved/verify", "POST", { confirmed: true }),
    request("/api/library/sources/saved", "DELETE"),
  ];
  for (const operation of operations) {
    const absent = await settings.handle(operation.clone(), () => null);
    expect(absent.status).toBe(401);
    expect(await absent.text()).not.toContain(media);
    const ordinary = await settings.handle(operation.clone(), () => ({ ...administrator, authority: "controller" }));
    expect(ordinary.status).toBe(403);
    expect(await ordinary.text()).not.toContain(media);
  }
  expect(changes).toEqual([]);
});

test("administrator can browse, test, start a scan, verify a legacy source and remove it", async () => {
  const { settings, root, changes } = await setup();
  const browse = await settings.handle(request(`/api/library/folders/browse?path=${encodeURIComponent(root)}`), () => administrator);
  expect(browse.status).toBe(200);
  expect((await browse.json()).locations[0].name).toBe("Movies");
  for (const action of ["test", "scan", "verify"]) {
    const result = await settings.handle(request(`/api/library/sources/saved/${action}`, "POST", action === "verify" ? { confirmed: true } : undefined), () => administrator);
    expect(result.status).toBe(action === "scan" ? 202 : 200);
    expect(result.headers.get("Cache-Control")).toBe("no-store");
  }
  expect((await settings.handle(request("/api/library/sources/saved", "DELETE"), () => administrator)).status).toBe(200);
  expect(changes).toEqual(["test:saved", "scan:saved", "verify:saved", "remove:saved"]);
});

test("duplicate, invalid and unconfirmed definitions preserve existing state", async () => {
  const { settings, media, sources, changes } = await setup();
  const before = JSON.stringify(sources);
  expect((await settings.handle(request("/api/library/sources", "POST", { path: media }), () => administrator)).status).toBe(409);
  expect((await settings.handle(request("/api/library/sources", "POST", { path: "/etc" }), () => administrator)).status).toBe(403);
  expect((await settings.handle(request("/api/library/sources", "POST", { path: media, ignored: true }), () => administrator)).status).toBe(400);
  expect((await settings.handle(request("/api/library/sources/saved/verify", "POST", { confirmed: false }), () => administrator)).status).toBe(400);
  expect(changes).toEqual([]);
  expect(JSON.stringify(sources)).toBe(before);
});

test("authorization is checked again after asynchronous filesystem inspection", async () => {
  const ready = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const { root, settings, changes } = await setup(async () => { ready.resolve(); await release.promise; return null; });
  const newFolder = join(root, "Other");
  await mkdir(newFolder);
  let caller: ControllerIdentity | null = administrator;
  const pending = settings.handle(request("/api/library/sources", "POST", { path: newFolder }), () => caller);
  await ready.promise;
  caller = null;
  release.resolve();
  const result = await pending;
  expect(result.status).toBe(401);
  expect(changes).toEqual([]);
});

test("authorization is checked again after receiving a delayed body", async () => {
  const { root, settings, changes } = await setup();
  const stream = new TransformStream<Uint8Array, Uint8Array>();
  const writer = stream.writable.getWriter();
  let caller: ControllerIdentity | null = administrator;
  const pending = settings.handle(new Request("http://couch/api/library/sources", { method: "POST", headers: { "Content-Type": "application/json" }, body: stream.readable }), () => caller);
  await writer.write(new TextEncoder().encode('{"path":'));
  caller = { ...administrator, authority: "controller" };
  await writer.write(new TextEncoder().encode(`${JSON.stringify(root)}}`));
  await writer.close();
  expect((await pending).status).toBe(403);
  expect(changes).toEqual([]);
});

test("late library authorization errors retain their HTTP status", async () => {
  const { root } = await setup();
  const source: ManagedFolder = { id: "saved", name: "Movies", path: root, status: "ready", error: null, warning: null, lastScanned: 1, itemCount: 2, scannedItems: 2, verified: true };
  const settings = createFolderSettings({ managedSources: () => [source], addSource: async () => {}, scan: () => Promise.resolve(), removeSource: () => {},
    testSource: async () => { throw new ControllerError("Pair again.", 401); },
  }, createMediaFolders({ roots: [root], mountInfo: async () => null }));
  expect((await settings.handle(request("/api/library/sources/saved/test", "POST"), () => administrator)).status).toBe(401);
});
