import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ControllerIdentity } from "../shared/controllers";
import { createControllers } from "./controllers";
import { openStore, type Store } from "./store";

const stores = new Set<Store>();
const directories: string[] = [];
let clock: ReturnType<typeof spyOn<typeof Date, "now">> | undefined;
const host = (): ControllerIdentity => ({ controller: null, authority: "host", claimAvailable: false });

function fixture(options: { file?: string; recoveryCode?: string; onChange?: () => void } = {}) {
  const store = openStore(options.file ?? ":memory:");
  stores.add(store);
  const changed = mock(options.onChange ?? (() => {}));
  const service = createControllers({ store, onChange: changed, recoveryCode: options.recoveryCode });
  const phone = (name = "Phone") => {
    const token = store.pair(name);
    const identity = (): ControllerIdentity | null => {
      const controller = store.controllerForToken(token);
      return controller ? { controller, authority: controller.role, claimAvailable: service.claimAvailable() } : null;
    };
    return { token, identity, id: identity()!.controller!.id };
  };
  const request = (path: string, method = "GET", input?: unknown, identity: () => ControllerIdentity | null = host) => service.handle(new Request(`http://localhost${path}`, {
    method, ...(input === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }),
  }), identity);
  const setup = async () => (await (await request("/api/controllers/claim-code")).json() as { code: string; expiresAt: number });
  return { store, changed, service, phone, request, setup };
}

function file() { const directory = mkdtempSync(join(tmpdir(), "couch-controller-api-")); directories.push(directory); return join(directory, "state.sqlite"); }
function close(store: Store) { store.close(); stores.delete(store); }

afterEach(() => {
  clock?.mockRestore();
  clock = undefined;
  for (const store of stores) store.close();
  stores.clear();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

test("only the native host can display an unclaimed setup code and identity responses omit credentials", async () => {
  const f = fixture();
  const phone = f.phone();
  const setup = await f.setup();
  expect(setup).toEqual({ code: expect.stringMatching(/^\d{10}$/), expiresAt: expect.any(Number) });
  expect(await f.setup()).toEqual(setup);
  expect((await f.request("/api/controllers/claim-code", "GET", undefined, phone.identity)).status).toBe(403);
  expect((await f.request("/api/controllers/claim-code", "GET", undefined, () => null)).status).toBe(401);
  const response = await f.request("/api/controllers/me", "GET", undefined, phone.identity);
  const identity = await response.json() as ControllerIdentity;
  expect(identity).toMatchObject({ controller: { name: "Phone", role: "controller" }, authority: "controller", claimAvailable: true });
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  for (const secret of [phone.token, setup.code, "token_hash", "code_hash"]) expect(JSON.stringify(identity)).not.toContain(secret);
  expect(await (await f.request("/api/controllers/me")).json()).toEqual({ controller: null, authority: "host", claimAvailable: true });
});

test("two simultaneous setup claims yield one administrator and publish only the committed identity", async () => {
  const f = fixture();
  const one = f.phone("One");
  const two = f.phone("Two");
  const setup = await f.setup();
  const observed: string[] = [];
  f.changed.mockImplementation(() => {
    expect(f.store.controllerClaim(setup.code)?.consumed).toBeTrue();
    observed.push([one, two].find(phone => f.store.controller(phone.id)?.role === "administrator")!.id);
  });
  const responses = await Promise.all([one, two].map(phone => f.request("/api/controllers/claim", "POST", { code: setup.code }, phone.identity)));
  expect(responses.map(response => response.status).sort()).toEqual([200, 401]);
  expect([one, two].filter(phone => f.store.controller(phone.id)?.role === "administrator")).toHaveLength(1);
  expect(observed).toHaveLength(1);
  expect(f.changed).toHaveBeenCalledTimes(1);
  expect(f.service.claimAvailable()).toBeFalse();
  expect((await f.request("/api/controllers/claim-code")).status).toBe(409);
  const admin = [one, two].find(phone => f.store.controller(phone.id)?.role === "administrator")!;
  expect((await f.request("/api/controllers/claim", "POST", { code: setup.code }, admin.identity)).status).toBe(409);
  expect((await f.request("/api/controllers/claim", "POST", { code: setup.code })).status).toBe(400);
});

test("setup codes refresh after expiry and invalidate the previous unconsumed code after coordinator restart", async () => {
  let now = 1_000;
  clock = spyOn(Date, "now").mockImplementation(() => now);
  const path = file();
  const first = fixture({ file: path });
  const phone = first.phone();
  const expired = await first.setup();
  now = expired.expiresAt;
  expect((await first.request("/api/controllers/claim", "POST", { code: expired.code }, phone.identity)).status).toBe(401);
  const refreshed = await first.setup();
  expect(refreshed.code).not.toBe(expired.code);
  expect(refreshed.expiresAt).toBe(now + 600_000);
  close(first.store);
  const second = fixture({ file: path });
  const restarted = await second.setup();
  expect(restarted.code).not.toBe(refreshed.code);
  expect(second.store.controllerClaim(refreshed.code)).toBeNull();
  expect(second.store.controllerForToken(phone.token)?.role).toBe("controller");
});

test("recovery availability is read from the durable claim ledger and never exposes the configured secret", async () => {
  const recoveryCode = "a1".repeat(32);
  const path = file();
  const first = fixture({ file: path, recoveryCode });
  const owner = first.phone("Owner");
  const replacement = first.phone("Replacement");
  const setup = await first.setup();
  expect((await first.request("/api/controllers/claim", "POST", { code: setup.code }, owner.identity)).status).toBe(200);
  expect(first.service.claimAvailable()).toBeTrue();
  const identity = await first.request("/api/controllers/me", "GET", undefined, replacement.identity);
  expect(await identity.text()).not.toContain(recoveryCode);
  expect((await first.request("/api/controllers/claim-code")).status).toBe(409);
  expect((await first.request("/api/controllers/claim", "POST", { code: recoveryCode }, replacement.identity)).status).toBe(200);
  expect(first.service.claimAvailable()).toBeFalse();
  close(first.store);
  const reopened = fixture({ file: path, recoveryCode });
  expect(reopened.service.claimAvailable()).toBeFalse();
  expect(reopened.store.controllerForToken(replacement.token)?.role).toBe("administrator");
  expect(reopened.store.controllerForToken(owner.token)?.role).toBe("administrator");
  expect(() => createControllers({ store: reopened.store, onChange: () => {}, recoveryCode: "short" })).toThrow("32 to 256 hexadecimal");
});

test("recovery configuration and claim requests share the 256-character upper bound", async () => {
  const maximum = "a".repeat(256);
  const oversized = "b".repeat(257);
  const f = fixture({ recoveryCode: maximum });
  const phone = f.phone();
  expect(() => createControllers({ store: f.store, onChange: () => {}, recoveryCode: oversized })).toThrow("32 to 256 hexadecimal");
  expect(f.store.controllerClaim(oversized)).toBeNull();
  // A stored code cannot bypass the request boundary even if inserted locally.
  f.store.createControllerClaim(oversized, true);
  expect((await f.request("/api/controllers/claim", "POST", { code: oversized }, phone.identity)).status).toBe(401);
  expect(f.store.controllerClaim(oversized)?.consumed).toBeFalse();
  expect(f.store.controller(phone.id)?.role).toBe("controller");
  expect((await f.request("/api/controllers/claim", "POST", { code: maximum }, phone.identity)).status).toBe(200);
  expect(f.changed).toHaveBeenCalledTimes(1);
});

test("restarting with an expired recovery code does not offer or extend it", async () => {
  let now = 1_000;
  clock = spyOn(Date, "now").mockImplementation(() => now);
  const recoveryCode = "cd".repeat(32);
  const path = file();
  const first = fixture({ file: path, recoveryCode });
  const owner = first.phone();
  const setup = await first.setup();
  await first.request("/api/controllers/claim", "POST", { code: setup.code }, owner.identity);
  const expiry = first.store.controllerClaim(recoveryCode)!.expiresAt;
  close(first.store);
  now = expiry;
  const second = fixture({ file: path, recoveryCode });
  const replacement = second.phone();
  expect(second.service.claimAvailable()).toBeFalse();
  expect(second.store.controllerClaim(recoveryCode)).toEqual({ expiresAt: expiry, consumed: false });
  expect((await second.request("/api/controllers/claim", "POST", { code: recoveryCode }, replacement.identity)).status).toBe(401);
  expect(second.changed).not.toHaveBeenCalled();
});

test("claim attempts have a shared bounded rate limit and request bodies reject unknown fields and excess bytes", async () => {
  let now = 1_000;
  clock = spyOn(Date, "now").mockImplementation(() => now);
  const f = fixture();
  const one = f.phone("One");
  const two = f.phone("Two");
  const setup = await f.setup();
  expect((await f.request("/api/controllers/claim", "POST", { code: setup.code, role: "administrator" }, one.identity)).status).toBe(400);
  for (let index = 1; index < 20; index++) expect((await f.request("/api/controllers/claim", "POST", { code: "0000000000" }, (index % 2 ? one : two).identity)).status).toBe(401);
  expect((await f.request("/api/controllers/claim", "POST", { code: setup.code }, two.identity)).status).toBe(429);
  expect(f.store.administratorExists()).toBeFalse();
  now += 60_000;
  expect((await f.request("/api/controllers/claim", "POST", { code: setup.code }, two.identity)).status).toBe(200);
  const bytes = new TextEncoder().encode(JSON.stringify({ name: "📱".repeat(2500) }));
  const stream = new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } });
  const oversized = await f.service.handle(new Request("http://localhost/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: stream }), host);
  expect(oversized.status).toBe(413);
  const invalid = await f.service.handle(new Request("http://localhost/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" }), host);
  expect(invalid.status).toBe(400);
  expect((await f.request("/api/settings", "POST", { name: "TV", role: "administrator" })).status).toBe(400);
  expect((await f.request("/api/settings", "POST", [])).status).toBe(400);
  expect(f.store.installationName()).toBe("Couch");
});

test("a claim rechecks authentication and role after a suspended request body", async () => {
  const f = fixture();
  const phone = f.phone();
  const setup = await f.setup();
  let caller = phone.identity();
  let finish!: (value: Uint8Array) => void;
  const stream = new ReadableStream<Uint8Array>({ start(controller) { finish = value => { controller.enqueue(value); controller.close(); }; } });
  const pending = f.service.handle(new Request("http://localhost/api/controllers/claim", { method: "POST", headers: { "Content-Type": "application/json" }, body: stream }), () => caller);
  caller = null;
  finish(new TextEncoder().encode(JSON.stringify({ code: setup.code })));
  expect((await pending).status).toBe(401);
  expect(f.store.controller(phone.id)?.role).toBe("controller");
  expect(f.store.controllerClaim(setup.code)?.consumed).toBeFalse();
  expect(f.changed).not.toHaveBeenCalled();
});

test("a second pending claim cannot consume another code after the same remote is promoted", async () => {
  const recoveryCode = "ef".repeat(32);
  const f = fixture({ recoveryCode });
  const phone = f.phone();
  const setup = await f.setup();
  let finish!: () => void;
  const stream = new ReadableStream({ start(controller) { finish = () => { controller.enqueue(new TextEncoder().encode(JSON.stringify({ code: recoveryCode }))); controller.close(); }; } });
  const pending = f.service.handle(new Request("http://localhost/api/controllers/claim", { method: "POST", headers: { "Content-Type": "application/json" }, body: stream }), phone.identity);
  expect((await f.request("/api/controllers/claim", "POST", { code: setup.code }, phone.identity)).status).toBe(200);
  finish();
  expect((await pending).status).toBe(409);
  expect(f.store.controllerClaim(recoveryCode)?.consumed).toBeFalse();
  expect(f.changed).toHaveBeenCalledTimes(1);
});

test("only current administrators or the native host rename the installation, followed by a committed change callback", async () => {
  const path = file();
  const f = fixture({ file: path });
  const phone = f.phone();
  expect(await (await f.request("/api/settings", "GET", undefined, phone.identity)).json()).toEqual({ name: "Couch" });
  expect((await f.request("/api/settings", "POST", { name: "Unauthorized" }, phone.identity)).status).toBe(403);
  const setup = await f.setup();
  await f.request("/api/controllers/claim", "POST", { code: setup.code }, phone.identity);
  f.changed.mockClear();
  f.changed.mockImplementation(() => {
    const db = new Database(path, { readonly: true });
    expect(db.query<{ name: string }, []>("SELECT name FROM installation").get()?.name).toBe("Living room");
    db.close();
  });
  expect(await (await f.request("/api/settings", "POST", { name: " Living room " }, phone.identity)).json()).toEqual({ name: "Living room" });
  expect(f.changed).toHaveBeenCalledTimes(1);
  f.changed.mockClear();
  let caller = phone.identity();
  let finish!: () => void;
  const stream = new ReadableStream({ start(controller) { finish = () => { controller.enqueue(new TextEncoder().encode('{"name":"Too late"}')); controller.close(); }; } });
  const pending = f.service.handle(new Request("http://localhost/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: stream }), () => caller);
  caller = { ...caller!, authority: "controller" };
  finish();
  expect((await pending).status).toBe(403);
  expect(f.store.installationName()).toBe("Living room");
  expect(f.changed).not.toHaveBeenCalled();
  f.changed.mockImplementation(() => {});
  expect((await f.request("/api/settings", "POST", { name: "TV" })).status).toBe(200);
  expect((await f.request("/api/settings", "GET", undefined, () => null)).status).toBe(401);
});

test("database write failures retain state, suppress broadcasts and return no database details", async () => {
  const path = file();
  const f = fixture({ file: path });
  const phone = f.phone();
  const setup = await f.setup();
  const db = new Database(path);
  db.run("CREATE TRIGGER reject_claim BEFORE UPDATE OF consumed ON controller_claims BEGIN SELECT RAISE(ABORT, 'SECRET database path'); END;");
  const claim = await f.request("/api/controllers/claim", "POST", { code: setup.code }, phone.identity);
  expect(claim.status).toBe(500);
  expect(await claim.text()).not.toContain("SECRET");
  expect(f.store.controller(phone.id)?.role).toBe("controller");
  expect(f.store.controllerClaim(setup.code)?.consumed).toBeFalse();
  db.run("CREATE TRIGGER reject_name BEFORE UPDATE ON installation BEGIN SELECT RAISE(ABORT, 'SECRET database path'); END;");
  const rename = await f.request("/api/settings", "POST", { name: "Failed" });
  expect(rename.status).toBe(500);
  expect(await rename.text()).not.toContain("SECRET");
  expect(f.store.installationName()).toBe("Couch");
  expect(f.changed).not.toHaveBeenCalled();
  db.close();
});

test("only current administrators manage named remotes and a racing demotion blocks a pending write", async () => {
  const f = fixture();
  const owner = f.phone("Owner"), guest = f.phone("Guest"), replacement = f.phone("Replacement");
  f.store.setControllerRole(owner.id, "administrator");
  expect((await f.request("/api/controllers", "GET", undefined, guest.identity)).status).toBe(403);
  for (const path of [`/api/controllers/${owner.id}/role`, `/api/controllers/${guest.id}/name`]) expect((await f.request(path, "POST", { role: "administrator" }, guest.identity)).status).toBe(403);
  expect((await f.request(`/api/controllers/${guest.id}`, "DELETE", undefined, guest.identity)).status).toBe(403);
  const listing = await (await f.request("/api/controllers", "GET", undefined, owner.identity)).json();
  expect(listing).toMatchObject({ controllers: expect.arrayContaining([expect.objectContaining({ name: "Owner", role: "administrator", lastSeenAt: expect.any(Number) }), expect.objectContaining({ name: "Guest", role: "controller" }), expect.objectContaining({ name: "Replacement" })]) });
  for (const secret of [owner.token, guest.token, "token_hash"]) expect(JSON.stringify(listing)).not.toContain(secret);
  expect((await f.request(`/api/controllers/${guest.id}/name`, "POST", { name: "Living room phone" }, owner.identity)).status).toBe(200);
  expect((await f.request(`/api/controllers/${replacement.id}/role`, "POST", { role: "administrator" }, owner.identity)).status).toBe(200);
  const bytes = Promise.withResolvers<void>();
  let finish!: () => void;
  const stream = new ReadableStream({ start(controller) { finish = () => { controller.enqueue(new TextEncoder().encode('{"name":"Too late"}')); controller.close(); }; }, pull() { bytes.resolve(); } });
  const pending = f.service.handle(new Request(`http://localhost/api/controllers/${guest.id}/name`, { method: "POST", headers: { "Content-Type": "application/json" }, body: stream }), owner.identity);
  await bytes.promise;
  expect((await f.request(`/api/controllers/${owner.id}/role`, "POST", { role: "controller" }, replacement.identity)).status).toBe(200);
  finish();
  expect((await pending).status).toBe(403);
  expect(f.store.controller(guest.id)?.name).toBe("Living room phone");
  expect((await f.request(`/api/controllers/${replacement.id}`, "DELETE", undefined, replacement.identity)).status).toBe(409);
  expect((await f.request(`/api/controllers/${replacement.id}/role`, "POST", { role: "controller" }, replacement.identity)).status).toBe(409);
});

test("revocation notification follows the committed credential deletion and failed writes do not notify", async () => {
  const path = file();
  const f = fixture({ file: path });
  const guest = f.phone();
  const revoked = mock((id: string) => { expect(id).toBe(guest.id); expect(f.store.controllerForToken(guest.token)).toBeNull(); });
  const service = createControllers({ store: f.store, onChange: f.changed, onRevoke: revoked });
  const request = () => service.handle(new Request(`http://localhost/api/controllers/${guest.id}`, { method: "DELETE" }), host);
  const db = new Database(path);
  db.run("CREATE TRIGGER reject_revoke BEFORE DELETE ON devices BEGIN SELECT RAISE(ABORT, 'SECRET'); END;");
  expect((await request()).status).toBe(500);
  expect(revoked).not.toHaveBeenCalled();
  expect(f.changed).not.toHaveBeenCalled();
  db.run("DROP TRIGGER reject_revoke");
  db.close();
  expect((await request()).status).toBe(200);
  expect(revoked).toHaveBeenCalledTimes(1);
  expect(f.changed).toHaveBeenCalledTimes(1);
});

test("first-run setup resumes after restart and only its administrator can advance the current step", async () => {
  const path = file();
  const first = fixture({ file: path });
  const owner = first.phone("Owner");
  const guest = first.phone("Guest");
  expect(first.store.setupStep()).toBe("general");
  expect((await first.request("/api/settings/setup", "POST", { step: "general" }, guest.identity)).status).toBe(403);
  expect((await first.request("/api/settings/setup", "POST", { step: "general" })).status).toBe(403);
  const { code } = await first.setup();
  expect((await first.request("/api/controllers/claim", "POST", { code }, owner.identity)).status).toBe(200);
  expect((await first.request("/api/settings", "POST", { name: "Living room" }, owner.identity)).status).toBe(200);
  expect((await first.request("/api/settings/setup", "POST", { step: "general" }, owner.identity)).status).toBe(200);
  expect((await first.request("/api/settings/setup", "POST", { step: "general" }, owner.identity)).status).toBe(409);
  close(first.store);
  const next = fixture({ file: path });
  const identity = (): ControllerIdentity => ({ controller: next.store.controllerForToken(owner.token), authority: "administrator", claimAvailable: false });
  expect(next.store.setupStep()).toBe("display");
  expect(next.store.installationName()).toBe("Living room");
  expect(next.service.claimAvailable()).toBeFalse();
  for (const step of ["display", "sound", "sources"]) expect((await next.request("/api/settings/setup", "POST", { step }, identity)).status).toBe(200);
  close(next.store);
  const final = fixture({ file: path });
  expect(final.store.setupStep()).toBe("complete");
  expect(final.store.controllerForToken(owner.token)?.role).toBe("administrator");
  expect(final.store.controllerForToken(guest.token)?.role).toBe("controller");
  expect(final.store.queue).toEqual([]);
});

test("existing claimed installations migrate to home while empty unclaimed installations still welcome", async () => {
  for (const claimed of [false, true]) {
    const path = file();
    const old = fixture({ file: path });
    if (claimed) {
      const phone = old.phone();
      const { code } = await old.setup();
      await old.request("/api/controllers/claim", "POST", { code }, phone.identity);
    }
    close(old.store);
    const legacy = new Database(path);
    legacy.run("DROP TABLE installation_setup");
    legacy.close();
    const migrated = fixture({ file: path });
    expect(migrated.store.setupStep()).toBe(claimed ? "complete" : "general");
    close(migrated.store);
    expect(fixture({ file: path }).store.setupStep()).toBe(claimed ? "complete" : "general");
  }
});

test("setup advancement rechecks administrator authority after a delayed request body", async () => {
  const f = fixture();
  const phone = f.phone();
  const { code } = await f.setup();
  await f.request("/api/controllers/claim", "POST", { code }, phone.identity);
  let caller = phone.identity();
  let streamController!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start(controller) { streamController = controller; } });
  const pending = f.service.handle(new Request("http://localhost/api/settings/setup", { method: "POST", headers: { "Content-Type": "application/json" }, body }), () => caller);
  caller = null;
  streamController.enqueue(new TextEncoder().encode('{"step":"general"}'));
  streamController.close();
  expect((await pending).status).toBe(401);
  expect(f.store.setupStep()).toBe("general");
});
