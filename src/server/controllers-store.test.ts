import { afterEach, expect, spyOn, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, type Store } from "./store";

const opened = new Set<Store>();
const directories: string[] = [];
let clock: ReturnType<typeof spyOn<typeof Date, "now">> | undefined;
const hash = (value: string) => new Bun.CryptoHasher("sha256").update(value).digest("hex");
const open = (path = ":memory:") => { const store = openStore(path); opened.add(store); return store; };
const close = (store: Store) => { store.close(); opened.delete(store); };
function path() { const directory = mkdtempSync(join(tmpdir(), "couch-controllers-")); directories.push(directory); return join(directory, "state.sqlite"); }

afterEach(() => {
  clock?.mockRestore();
  clock = undefined;
  for (const store of opened) store.close();
  opened.clear();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

test("legacy pairing migration preserves exact token hashes, stable identities and viewing data across restart", () => {
  const file = path();
  const initial = open(file);
  const profile = initial.createProfile("Ada");
  initial.selectProfile(profile.id);
  initial.saveQueue([{ id: "saved", title: "Saved", source: "library:saved" }]);
  initial.saveVolume(24);
  initial.saveProgress(profile.id, { mediaId: "library:saved", title: "Saved", libraryItemId: "saved", position: 48, duration: 200, watched: false, lastPlayedAt: 100 });
  close(initial);
  const tokens = [crypto.randomUUID(), crypto.randomUUID()];
  const legacy = new Database(file);
  legacy.run("DROP TABLE installation_setup; DROP TABLE devices; CREATE TABLE devices (token_hash TEXT PRIMARY KEY);");
  for (const token of tokens) legacy.query("INSERT INTO devices VALUES (?)").run(hash(token));
  legacy.close();

  const migrated = open(file);
  const devices = tokens.map(token => migrated.controllerForToken(token)!);
  expect(devices.map(device => device.name)).toEqual(["Remote 1", "Remote 2"]);
  for (const device of devices) expect(device).toEqual({ id: expect.any(String), name: expect.any(String), role: "controller", createdAt: null, lastSeenAt: null });
  expect(new Set(devices.map(device => device.id)).size).toBe(2);
  expect(migrated.administratorExists()).toBeFalse();
  expect(migrated.setupStep()).toBe("complete");
  expect(migrated.activeProfile()).toEqual(profile);
  expect(migrated.progress(profile.id, "library:saved")?.position).toBe(48);
  expect(migrated.queue).toEqual([{ id: "saved", title: "Saved", source: "library:saved" }]);
  expect(migrated.volume).toBe(24);
  close(migrated);
  const reopened = open(file);
  expect(tokens.map(token => reopened.controllerForToken(token))).toEqual(devices);
  expect(reopened.setupStep()).toBe("complete");
  for (const token of tokens) expect(reopened.isPaired(token)).toBeTrue();
  const db = new Database(file, { readonly: true });
  const rows = db.query<{ token_hash: string }, []>("SELECT token_hash FROM devices ORDER BY rowid").all();
  expect(rows.map(row => row.token_hash)).toEqual(tokens.map(hash));
  db.close();
  for (const secret of [...tokens, ...tokens.map(hash)]) expect(JSON.stringify(devices)).not.toContain(secret);
});

test("pairing stores normalized names and grants administration only to the first remembered remote", () => {
  const store = open();
  const token = store.pair("  Cafe\u0301 remote  ");
  const device = store.controllerForToken(token)!;
  expect(device).toMatchObject({ name: "Café remote", role: "administrator", createdAt: expect.any(Number), lastSeenAt: expect.any(Number) });
  expect(store.controller(device.id)).toEqual(device);
  expect(store.controllerForToken(store.pair())?.name).toBe("Remote");
  expect(store.controllerForToken(store.pair("Café remote"))?.id).not.toBe(device.id);
  expect(store.controllerForToken(store.pair("📱".repeat(60)))?.name).toBe("📱".repeat(60));
  for (const name of [null, {}, 5, "", "   ", "a".repeat(61), "bad\nname", "bad\u0085name"]) expect(() => store.pair(name)).toThrow("Use a name with 1 to 60 characters.");
  expect(store.controllerForToken("unknown")).toBeNull();
  expect(store.controllerForToken("x".repeat(129))).toBeNull();
  expect(store.administratorExists()).toBeTrue();
});

test("last seen writes at most once a minute and never moves backwards", () => {
  let now = 1_000;
  clock = spyOn(Date, "now").mockImplementation(() => now);
  const store = open();
  const device = store.controllerForToken(store.pair())!;
  now = 60_999;
  store.touchController(device.id);
  expect(store.controller(device.id)?.lastSeenAt).toBe(1_000);
  now = 61_000;
  store.touchController(device.id);
  expect(store.controller(device.id)?.lastSeenAt).toBe(61_000);
  now = 100;
  store.touchController(device.id);
  expect(store.controller(device.id)?.lastSeenAt).toBe(61_000);
  expect(() => store.touchController("missing")).not.toThrow();
});

test("setup claims expire, replace older setup codes and grant only the first existing controller", () => {
  let now = 100;
  clock = spyOn(Date, "now").mockImplementation(() => now);
  const store = open();
  const one = store.controllerForToken(store.pair("One"))!;
  const two = store.controllerForToken(store.pair("Two"))!;
  store.setControllerRole(one.id, "controller");
  expect(store.createControllerClaim("1111111111", false)).toEqual({ expiresAt: 600_100, consumed: false });
  store.createControllerClaim("2222222222", false);
  expect(store.controllerClaim("1111111111")).toBeNull();
  expect(() => store.consumeControllerClaim(one.id, "1111111111")).toThrow("invalid or expired");
  now = 600_100;
  expect(() => store.consumeControllerClaim(one.id, "2222222222")).toThrow("invalid or expired");
  const fresh = store.createControllerClaim("3333333333", false);
  expect(() => store.consumeControllerClaim("removed", "3333333333")).toThrow("Pair this device");
  expect(store.controllerClaim("3333333333")).toEqual(fresh);
  expect(store.consumeControllerClaim(one.id, "3333333333").role).toBe("administrator");
  expect(store.controllerClaim("3333333333")?.consumed).toBeTrue();
  expect(() => store.consumeControllerClaim(two.id, "3333333333")).toThrow("invalid or expired");
  store.createControllerClaim("4444444444", false);
  expect(() => store.consumeControllerClaim(two.id, "4444444444")).toThrow("already has an administrator");
  expect(store.controllerClaim("4444444444")?.consumed).toBeFalse();
});

test("recovery expiry and consumption survive restart without retaining plaintext secrets", () => {
  let now = 1_000;
  clock = spyOn(Date, "now").mockImplementation(() => now);
  const file = path();
  const expiredCode = "a".repeat(64);
  const consumedCode = "b".repeat(64);
  const freshCode = "c".repeat(64);
  const first = open(file);
  const one = first.controllerForToken(first.pair("One"))!;
  const two = first.controllerForToken(first.pair("Two"))!;
  first.setControllerRole(one.id, "controller");
  const expired = first.createControllerClaim(expiredCode, true);
  first.createControllerClaim(consumedCode, true);
  first.consumeControllerClaim(one.id, consumedCode);
  close(first);
  now = 601_000;
  const second = open(file);
  expect(second.createControllerClaim(expiredCode, true)).toEqual(expired);
  expect(second.createControllerClaim(consumedCode, true)).toEqual({ expiresAt: expired.expiresAt, consumed: true });
  expect(() => second.consumeControllerClaim(two.id, expiredCode)).toThrow("invalid or expired");
  expect(() => second.consumeControllerClaim(two.id, consumedCode)).toThrow("invalid or expired");
  second.createControllerClaim(freshCode, true);
  expect(second.consumeControllerClaim(two.id, freshCode).role).toBe("administrator");
  expect(second.controller(one.id)?.role).toBe("administrator");
  close(second);
  const third = open(file);
  expect(third.controllerClaim(freshCode)?.consumed).toBeTrue();
  const db = new Database(file, { readonly: true });
  const claims = db.query("SELECT * FROM controller_claims").all();
  db.close();
  for (const secret of [expiredCode, consumedCode, freshCode]) expect(JSON.stringify(claims)).not.toContain(secret);
});

test("a failed claim commit rolls back both role promotion and code consumption", () => {
  const file = path();
  const store = open(file);
  const device = store.controllerForToken(store.pair())!;
  store.setControllerRole(device.id, "controller");
  const claim = store.createControllerClaim("1111111111", false);
  const db = new Database(file);
  db.run("CREATE TRIGGER reject_claim BEFORE UPDATE OF consumed ON controller_claims BEGIN SELECT RAISE(ABORT, 'Private database failure'); END;");
  expect(() => store.consumeControllerClaim(device.id, "1111111111")).toThrow("Private database failure");
  expect(store.controller(device.id)?.role).toBe("controller");
  expect(store.controllerClaim("1111111111")).toEqual(claim);
  db.run("DROP TRIGGER reject_claim");
  db.close();
  expect(store.consumeControllerClaim(device.id, "1111111111").role).toBe("administrator");
});

test("installation names persist separately from watching profiles and controller names", () => {
  const file = path();
  const first = open(file);
  const token = first.pair("Owner phone");
  expect(first.installationName()).toBe("Couch");
  expect(first.renameInstallation("  Cafe\u0301 TV  ")).toBe("Café TV");
  expect(first.controllerForToken(token)?.name).toBe("Owner phone");
  expect(first.activeProfile().name).toBe("Household");
  expect(() => first.renameInstallation(" ")).toThrow();
  expect(first.installationName()).toBe("Café TV");
  close(first);
  expect(open(file).installationName()).toBe("Café TV");
});

test("device management persists names and roles and permits removing the final administrator", () => {
  const file = path();
  const store = open(file);
  const oneToken = store.pair("One"), twoToken = store.pair("Two");
  const one = store.controllerForToken(oneToken)!, two = store.controllerForToken(twoToken)!;
  store.setControllerRole(one.id, "administrator");
  expect(store.setControllerRole(one.id, "controller").role).toBe("controller");
  expect(store.administratorExists()).toBeFalse();
  expect(store.renameController(two.id, "  Kitchen remote  ").name).toBe("Kitchen remote");
  expect(() => store.setControllerRole(two.id, "host")).toThrow("Choose Controller or Administrator");
  store.setControllerRole(two.id, "administrator");
  store.setControllerRole(one.id, "controller");
  store.revokeController(one.id);
  expect(store.isPaired(oneToken)).toBeFalse();
  expect(store.controllerForToken(oneToken)).toBeNull();
  expect(() => store.renameController(one.id, "Gone")).toThrow("no longer paired");
  close(store);
  const reopened = open(file);
  expect(reopened.controllers()).toEqual([expect.objectContaining({ id: two.id, name: "Kitchen remote", role: "administrator" })]);
  expect(reopened.controllerForToken(twoToken)?.role).toBe("administrator");
  reopened.revokeController(two.id);
  expect(reopened.controllers()).toEqual([]);
  expect(reopened.controllerForToken(reopened.pair("New owner"))?.role).toBe("administrator");
});
