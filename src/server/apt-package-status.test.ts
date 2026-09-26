import { expect, test } from "bun:test";
import { readAptPackageStatus, aptUpgradeCounts } from "./apt-package-status";

test("counts Debian upgrades and Debian-Security once per package, excluding new and third-party packages", () => {
  expect(aptUpgradeCounts(`Inst libc6:amd64 [2.41-11] (2.41-12 Debian:13.7/stable [amd64])
Inst curl [8.14.1-1] (8.14.1-2 Debian:13.7/stable, Debian-Security:13/stable-security [amd64])
Inst openssl [3.5.1-1] (3.5.1-2 Debian-Security:13/stable-security [amd64])
Inst libnew (1.0 Debian:13.7/stable [amd64])
Inst security-dependency (1.0 Debian-Security:13/stable-security [amd64])
Inst couch [1] (2 Couch:stable [amd64])
Inst vendor [1] (2 Vendor:stable-security [amd64])
Inst derivative [1] (2 Debian-Other:13/stable [amd64])
Conf openssl (3.5.1-2 Debian-Security:13/stable-security [amd64])
Remv old-package [1]`)).toEqual({ available: 3, security: 2 });
});

test("counts actionable Ubuntu upgrades and security, excluding new dependencies and other origins", () => {
  expect(aptUpgradeCounts(`Inst openssl [3.0.13] (3.0.14 Ubuntu:24.04/noble-updates, Ubuntu:24.04/noble-security [amd64])
Inst curl [8.5.0] (8.5.1 Ubuntu:24.04/noble-updates [amd64])
Inst dependency (1.0 Ubuntu:24.04/noble-security [amd64])
Inst couch [1] (2 Couch:stable [amd64])
Conf openssl (3.0.14 Ubuntu:24.04/noble-security [amd64])`)).toEqual({ available: 2, security: 1 });
});

test("healthy indexes with no upgrades report zero", async () => {
  const calls: string[][] = [];
  const value = await readAptPackageStatus(async args => { calls.push(args); return ""; });
  expect(calls).toEqual([["check"], ["--with-new-pkgs", "upgrade"]]);
  expect(value).toMatchObject({ available: 0, security: 0, broken: 0, error: null });
});

test("failed dependency check never reports invented healthy or upgrade counts", async () => {
  const value = await readAptPackageStatus(async () => { throw new Error("broken dependencies"); });
  expect(value).toMatchObject({ available: null, security: null, broken: null });
  expect(value.error).toContain("Couldn't check system packages");
});

test("failed upgrade simulation preserves a successful dependency check", async () => {
  const value = await readAptPackageStatus(async args => { if (args[0] === "check") return ""; throw new Error("timeout"); });
  expect(value).toMatchObject({ available: null, security: null, broken: 0 });
  expect(value.error).toContain("Couldn't check system packages");
});
