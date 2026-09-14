import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import type { AptPackageStatus } from "../shared/tool-health";

const environment = { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" };
const apt = (args: string[]): Promise<string> => new Promise((resolve, reject) => {
  execFile("/usr/bin/apt-get", ["--simulate", "--quiet", ...args], {
    env: environment, timeout: 5_000, maxBuffer: 1024 * 1024, encoding: "utf8", killSignal: "SIGKILL",
  }, (error, stdout) => error ? reject(error) : resolve(stdout));
});

// APT's simulated Inst records use Label:Version/Archive for each source.
// Count distribution upgrades, excluding new dependencies and third-party archives.
export function aptUpgradeCounts(output: string) {
  const upgrades = output.split("\n").filter(line => /^Inst \S+ \[[^\]]+\] \(/.test(line) && /[ (](?:Debian(?:-Security)?|Ubuntu):[^ ,)]+/.test(line));
  return { available: upgrades.length, security: upgrades.filter(line => /[ (](?:Debian-Security:[^ ,)]+|Ubuntu:[^ ,)]*-security)(?=[ ,)]|$)/.test(line)).length };
}

export async function readAptPackageStatus(command = apt): Promise<AptPackageStatus> {
  const value: AptPackageStatus = {
    available: null, security: null, broken: null,
    indexUpdatedAt: await stat("/var/lib/apt/periodic/update-stamp").then(value => Math.trunc(value.mtimeMs)).catch(() => null),
    checkedAt: new Date().toISOString(), error: null,
  };
  try {
    await command(["check"]);
    value.broken = 0;
    Object.assign(value, aptUpgradeCounts(await command(["--with-new-pkgs", "upgrade"])));
  } catch {
    value.error = "System package checks failed or timed out. Ask the machine administrator to inspect APT locally. Couch releases are separate.";
  }
  return value;
}
