import { buildInfo } from "./build-info";
import { closeSync, constants, fstatSync, openSync } from "node:fs";
import { spawnSync } from "node:child_process";

/** Retain the package read lock even if the native frontend dies first. */
export function nativePackageLock() {
  const inherited = process.env.COUCH_PACKAGE_LOCK_FD;
  delete process.env.COUCH_PACKAGE_LOCK_FD;
  if (process.env.COUCH_PACKAGE_FORMAT !== "deb" || process.env.COUCH_NATIVE !== "1") return () => {};
  // Development admission fixtures have no installed package or native parent.
  if (inherited === undefined && !buildInfo.packaged) return () => {};
  if (!inherited || !/^\d+$/.test(inherited) || Number(inherited) < 3) throw new Error("The native package lock was not inherited from Couch.");
  const bridge = Number(inherited);
  const fd = openSync("/var/lib/couch-updater/lock", constants.O_RDONLY | constants.O_NOFOLLOW);
  const metadata = fstatSync(fd), parent = fstatSync(bridge);
  if (!metadata.isFile() || metadata.uid !== 0 || (metadata.mode & 0o022) || metadata.dev !== parent.dev || metadata.ino !== parent.ino) throw new Error("The native package lock identity is invalid.");
  // Node opens fd with CLOEXEC. flock receives an explicit duplicate and locks
  // this same open description; our fd keeps that lock after flock exits.
  const result = spawnSync("/usr/bin/flock", ["--shared", "3"], { stdio: ["ignore", "ignore", "pipe", fd], timeout: 10_000 });
  if (result.error || result.status !== 0) throw new Error("The backend could not retain the native package lock.");
  closeSync(bridge);
  let held = true;
  return () => { if (held) { closeSync(fd); held = false; } };
}
