import { afterEach, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { Identity } from "@sonn-audio/node-sendspin";
import { SendspinCore, loadSendspinClientIdentity, type SendspinPlayerConfig } from "@sendspin/sendspin-js";
import { createSendspin } from "../../server/sendspin";
import { createSendspinRenderer, sendspinReconnectStopped } from "./sendspin-renderer";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function until(check: () => boolean, label: string) {
  const end = Date.now() + 5000;
  while (!check()) { if (Date.now() > end) throw new Error(label); await Bun.sleep(5); }
}
async function fixture(admit: boolean) {
  const keys = new Map<string, string>();
  let admitted = false, admissions = 0;
  const host = createSendspin({ host: "127.0.0.1", port: 0, name: "Reconnect fixture" }, { identity: Identity.generate().privateB64u, lookupPsk: id => keys.get(id) ?? null, changed: target => { const connected = !!target.members?.some(member => member.connected); if (connected && !admitted) admissions++; admitted = connected; }, observe: () => {} });
  cleanups.push(() => host.close());
  await until(() => !!host.port, "host listener");
  const storageValues = new Map<string, string>();
  const storage = { getItem: (key: string) => storageValues.get(key) ?? null, setItem: (key: string, value: string) => { storageValues.set(key, value); } };
  const clientId = loadSendspinClientIdentity(storage).clientId;
  const psk = randomBytes(32).toString("base64url");
  if (admit) keys.set(clientId, psk);
  const attempts: number[] = [], errors: Error[] = [];
  let disconnects = 0;
  const library = {
    loadSendspinClientIdentity,
    SendspinPlayer: class {
      core: SendspinCore;
      constructor(config: SendspinPlayerConfig) {
        this.core = new SendspinCore({ ...config, codecs: ["pcm"], reconnect: {
          ...config.reconnect, baseDelayMs: 1, maxDelayMs: 1,
          onReconnecting: attempt => { attempts.push(attempt); config.reconnect?.onReconnecting?.(attempt); },
        } });
      }
      unlock() { return Promise.resolve(); }
      connect() { return this.core.connect(); }
      disconnect() { disconnects++; this.core.disconnect("user_request"); }
      get isConnected() { return this.core.isConnected; }
      setVolume(value: number) { this.core.setVolume(value); }
      setMuted(value: boolean) { this.core.setMuted(value); }
      sendCommand(command: "play", params: undefined) { this.core.sendCommand(command, params); }
      openPairingWindow() { this.core.openPairingWindow(); }
    },
  };
  const renderer = createSendspinRenderer({ url: `http://127.0.0.1:${host.port}`, name: "Reconnect fixture", serverId: host.serverId, psk }, { state: () => {}, error: error => errors.push(error) }, { storage, loadLibrary: async () => library as unknown as typeof import("@sendspin/sendspin-js") });
  cleanups.push(() => renderer.disconnect());
  await renderer.preload();
  await renderer.connectFromGesture();
  return { host, keys, clientId, renderer, attempts, errors, get admitted() { return admitted; }, get admissions() { return admissions; }, get disconnects() { return disconnects; } };
}

test("real encrypted denial stops after a bounded number of socket opens", async () => {
  const f = await fixture(false);
  await until(() => f.errors.length > 0, "denied terminal error");
  expect(f.errors.map(error => error.message)).toEqual([sendspinReconnectStopped]);
  expect(f.attempts).toHaveLength(8);
  expect(f.attempts).toEqual(Array(8).fill(1));
  expect(f.disconnects).toBe(1);
  await Bun.sleep(50);
  expect(f.attempts).toHaveLength(8);
  expect(f.renderer.transport("play")).toBe(false);
}, 10000);

test("revoked encrypted enrollment remains denied when the retry budget ends", async () => {
  const f = await fixture(true);
  await until(() => f.admitted, "initial encrypted admission");
  f.keys.delete(f.clientId);
  f.host.disconnectClient(f.clientId);
  await until(() => f.errors.length > 0, "revoked terminal error");
  expect(f.errors.map(error => error.message)).toEqual([sendspinReconnectStopped]);
  expect(f.attempts).toHaveLength(8);
  expect(f.disconnects).toBe(1);
  expect(f.admissions).toBe(1);
  expect(f.admitted).toBe(false);
}, 10000);

test("Leave cancels real encrypted retries before the budget is exhausted", async () => {
  const f = await fixture(false);
  await until(() => f.attempts.length > 0, "denied retry started");
  await f.renderer.disconnect();
  const before = f.attempts.length;
  await Bun.sleep(50);
  expect(f.attempts).toHaveLength(before);
  expect(f.errors).toEqual([]);
  expect(f.admitted).toBe(false);
}, 10000);

test("a transient encrypted transport drop readmits before the Join budget", async () => {
  const f = await fixture(true);
  await until(() => f.admitted, "initial encrypted admission");
  f.host.disconnectClient(f.clientId);
  await until(() => f.attempts.length > 0 && f.admissions >= 2, "encrypted readmission");
  await Bun.sleep(80);
  expect(f.errors).toEqual([]);
  expect(f.attempts.length).toBeLessThanOrEqual(7);
  expect(f.disconnects).toBe(0);
}, 10000);
