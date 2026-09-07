import { expect, test } from "bun:test";
import { readUbuntuPackageStatus, ubuntuUpgradeCounts } from "./ubuntu-package-status";

test("counts actionable Ubuntu upgrades and security, excluding new dependencies and other origins", () => {
  expect(ubuntuUpgradeCounts(`Inst openssl [3.0.13] (3.0.14 Ubuntu:24.04/noble-updates, Ubuntu:24.04/noble-security [amd64])
Inst curl [8.5.0] (8.5.1 Ubuntu:24.04/noble-updates [amd64])
Inst dependency (1.0 Ubuntu:24.04/noble-security [amd64])
Inst couch [1] (2 Couch:stable [amd64])
Conf openssl (3.0.14 Ubuntu:24.04/noble-security [amd64])`)).toEqual({ available: 2, security: 1 });
});

test("healthy indexes with no upgrades report zero", async () => {
  const calls: string[][] = [];
  const value = await readUbuntuPackageStatus(async args => { calls.push(args); return ""; });
  expect(calls).toEqual([["check"], ["--with-new-pkgs", "upgrade"]]);
  expect(value).toMatchObject({ available: 0, security: 0, broken: 0, error: null });
});

test("failed dependency check never reports invented healthy or upgrade counts", async () => {
  const value = await readUbuntuPackageStatus(async () => { throw new Error("broken dependencies"); });
  expect(value).toMatchObject({ available: null, security: null, broken: null });
  expect(value.error).toContain("checks failed");
});

test("failed upgrade simulation preserves a successful dependency check", async () => {
  const value = await readUbuntuPackageStatus(async args => { if (args[0] === "check") return ""; throw new Error("timeout"); });
  expect(value).toMatchObject({ available: null, security: null, broken: 0 });
  expect(value.error).toContain("timed out");
});
