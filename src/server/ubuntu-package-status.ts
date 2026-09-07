import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import type { UbuntuPackageStatus } from "../shared/tool-health";

const environment = { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" };
const apt = (args: string[]): Promise<string> => new Promise((resolve, reject) => {
  execFile("/usr/bin/apt-get", ["--simulate", "--quiet", ...args], {
    env: environment, timeout: 5_000, maxBuffer: 1024 * 1024, encoding: "utf8", killSignal: "SIGKILL",
  }, (error, stdout) => error ? reject(error) : resolve(stdout));
});

// APT documents Inst records for simulation. Count upgrades, excluding new
// dependencies and third-party archives. This describes the resolver's plan.
export function ubuntuUpgradeCounts(output: string) {
  const upgrades = output.split("\n").filter(line => /^Inst \S+ \[[^\]]+\] \(/.test(line) && /[ (]Ubuntu:[^ )]+/.test(line));
  return { available: upgrades.length, security: upgrades.filter(line => /[ (]Ubuntu:[^ )]*-security\b/.test(line)).length };
}

export async function readUbuntuPackageStatus(command = apt): Promise<UbuntuPackageStatus> {
  const value: UbuntuPackageStatus = {
    available: null, security: null, broken: null,
    indexUpdatedAt: await stat("/var/lib/apt/periodic/update-stamp").then(value => Math.trunc(value.mtimeMs)).catch(() => null),
    checkedAt: new Date().toISOString(), error: null,
  };
  try {
    await command(["check"]);
    value.broken = 0;
    Object.assign(value, ubuntuUpgradeCounts(await command(["--with-new-pkgs", "upgrade"])));
  } catch {
    value.error = "Ubuntu package checks failed or timed out. Inspect APT through SSH; Couch releases are separate.";
  }
  return value;
}
