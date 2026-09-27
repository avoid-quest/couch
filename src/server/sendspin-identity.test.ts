import { expect, test } from "bun:test";
import { Identity } from "@sonn-audio/node-sendspin";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSendspinIdentity } from "./sendspin-identity";

test("identity and enrollment survive disk reopen; revocation removes only its owner's keys", () => {
  const directory = mkdtempSync(join(tmpdir(), "couch-sendspin-identity-"));
  const path = join(directory, "couch.sqlite");
  let store = openSendspinIdentity(path);
  try {
    const id = Identity.generate().peerId;
    const second = Identity.generate().peerId;
    const other = Identity.generate().peerId;
    const enrolled = store.enroll("owner", id);
    store.enroll("owner", second);
    const otherEnrollment = store.enroll("other", other);
    const privateKey = store.privateKey;
    expect(Identity.fromPrivateB64u(privateKey).peerId).toBe(store.serverId);
    expect(Buffer.from(enrolled.psk, "base64url")).toHaveLength(32);
    store.close();
    store = openSendspinIdentity(path);
    expect(store.privateKey).toBe(privateKey);
    expect(store.serverId).toBe(enrolled.serverId);
    expect(store.enroll("owner", id)).toEqual(enrolled);
    expect(store.lookup(id)).toBe(enrolled.psk);
    expect(store.owner(id)).toBe("owner");
    expect(store.revoke("owner").sort()).toEqual([id, second].sort());
    expect(store.lookup(id)).toBeNull();
    expect(store.lookup(second)).toBeNull();
    expect(store.owner(id)).toBeNull();
    expect(store.owner(other)).toBe("other");
    expect(store.lookup(other)).toBe(otherEnrollment.psk);
    expect(store.revoke("owner")).toEqual([]);
    store.close();
    store = openSendspinIdentity(path);
    expect(store.lookup(id)).toBeNull();
    expect(store.lookup(other)).toBe(otherEnrollment.psk);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("memory identity is stable per instance and enrollment cannot transfer another owner's client", () => {
  const store = openSendspinIdentity(":memory:");
  const other = openSendspinIdentity(":memory:");
  try {
    const client = Identity.generate().peerId;
    const enrolled = store.enroll("owner", client);
    expect(store.enroll("owner", client)).toEqual(enrolled);
    expect(() => store.enroll("intruder", client)).toThrow("another controller");
    expect(store.lookup(client)).toBe(enrolled.psk);
    expect(other.lookup(client)).toBeNull();
    expect(other.serverId).not.toBe(store.serverId);
    store.revoke("owner");
    expect(store.enroll("replacement", client).psk).not.toBe(enrolled.psk);
  } finally { store.close(); other.close(); }
});

test("invalid and noncanonical client identities never enroll or alias stored keys", () => {
  const store = openSendspinIdentity(":memory:");
  try {
    for (const id of ["", "a".repeat(42), "a".repeat(44), "/".repeat(43), "A".repeat(42) + "B"]) {
      expect(() => store.enroll("owner", id)).toThrow("Invalid Sendspin client identity");
      expect(store.lookup(id)).toBeNull();
      expect(store.owner(id)).toBeNull();
    }
    expect(() => store.enroll("", Identity.generate().peerId)).toThrow("authenticated controller");
  } finally { store.close(); }
});

test("explicit member selection persists in order and owner revocation removes its members", () => {
  const directory = mkdtempSync(join(tmpdir(), "couch-sendspin-members-"));
  const path = join(directory, "couch.sqlite");
  let store = openSendspinIdentity(path);
  try {
    const first = Identity.generate().peerId;
    const second = Identity.generate().peerId;
    const unselected = Identity.generate().peerId;
    store.enroll("owner", first);
    store.enroll("other", second);
    expect(store.members()).toEqual([]);
    store.saveMembers([second, first]);
    store.enroll("owner", unselected);
    expect(store.members()).toEqual([second, first]);
    store.close();
    store = openSendspinIdentity(path);
    expect(store.members()).toEqual([second, first]);
    store.revoke("owner");
    expect(store.members()).toEqual([second]);
    store.close();
    store = openSendspinIdentity(path);
    expect(store.members()).toEqual([second]);
    store.saveMembers([]);
    expect(store.members()).toEqual([]);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("member validation preserves the previous selection on invalid replacement", () => {
  const store = openSendspinIdentity(":memory:");
  try {
    const members = Array.from({ length: 33 }, () => Identity.generate().peerId);
    store.saveMembers(members.slice(0, 32));
    for (const invalid of [members, [members[0]!, members[0]!], ["invalid"]]) {
      expect(() => store.saveMembers(invalid)).toThrow("32 unique");
      expect(store.members()).toEqual(members.slice(0, 32));
    }
  } finally { store.close(); }
});
