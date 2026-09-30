import { expect, test } from "bun:test";
import { loadSendspinClientIdentity } from "@sendspin/sendspin-js";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDeviceIdentity } from "../app/device-identity";

test("native identity migrates an existing SDK key and keeps its name across server origins and restarts", () => {
  const directory = mkdtempSync(join(tmpdir(), "couch-device-identity-"));
  const path = join(directory, "identity.json");
  try {
    const origin = new Map<string, string>();
    const old = loadSendspinClientIdentity({ getItem: key => origin.get(key) ?? null, setItem: (key, value) => { origin.set(key, value); } });
    const identity = createDeviceIdentity(path);
    const first = identity({ key: origin.get("sendspin-identity-sk"), name: "  Living room  " });
    expect(first.name).toBe("Living room");
    expect(first.sharing).toEqual({ audio: false, video: false, administration: false });
    const anotherOrigin = new Map<string, string>();
    const adopted = loadSendspinClientIdentity({
      getItem: key => key === "sendspin-identity-sk" ? first.key : anotherOrigin.get(key) ?? null,
      setItem: (key, value) => { anotherOrigin.set(key, value); },
    });
    expect(adopted.clientId).toBe(old.clientId);
    identity({ name: "Bedroom" });
    expect(createDeviceIdentity(path)({ key: "x".repeat(43) })).toMatchObject({ key: first.key, name: "Bedroom" });
    expect(() => identity({ name: "\n" })).toThrow();
    expect(JSON.parse(readFileSync(path, "utf8")).name).toBe("Bedroom");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("null or corrupt native identity data recovers a usable SDK key with sharing off", () => {
  const directory = mkdtempSync(join(tmpdir(), "couch-device-identity-"));
  const path = join(directory, "identity.json");
  try {
    for (const value of [null, { key: "broken", name: 42, sharing: { audio: true } }]) {
      writeFileSync(path, JSON.stringify(value));
      const identity = createDeviceIdentity(path)();
      const sdk = loadSendspinClientIdentity({ getItem: key => key === "sendspin-identity-sk" ? identity.key : null, setItem: () => {} });
      expect(sdk.clientId).toMatch(/^[\w-]{43}$/);
      expect(identity.name).toBeNull();
      expect(identity.sharing).toEqual({ audio: false, video: false, administration: false });
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
