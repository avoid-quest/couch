import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";

// Windows' Smart App Control refuses to start a downloaded installer whose
// publisher it can't confirm, and Couch's are unsigned. Windows doesn't vet
// resources/app.asar, so when a release changes nothing else, Couch replaces
// only that file, with the exe Windows already runs (docs/ci.md).
export type AppManifest = {
  version: string;
  asar: { sha256: string; size: number };
  // Every other installed file's SHA-256, except the exe, whose only change is its version label.
  files: Record<string, string>;
};

const releases = "https://github.com/avoid-quest/couch/releases/download";
export const appUpdateName = (version: string) => `Couch-${version}-x64.app`;
const next = () => join(process.resourcesPath, "app.next");

const sha256 = async (path: string) => {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
};

// The release's manifest when this installation can take its app.asar alone, else null.
export async function findAppUpdate(version: string): Promise<AppManifest | null> {
  const response = await fetch(`${releases}/v${version}/${appUpdateName(version)}.json`);
  // Releases published before app-only updates have no manifest.
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Couldn't read the update manifest (${response.status}).`);
  const manifest = (await response.json()) as AppManifest;
  if (manifest.version !== version) throw new Error("The update manifest names another version.");
  const installed = dirname(process.execPath);
  for (const [file, hash] of Object.entries(manifest.files)) {
    const path = join(installed, file);
    if (!existsSync(path) || (await sha256(path)) !== hash) return null;
  }
  return manifest;
}

// About 9 MB, so it is read whole and checked before it can replace anything.
export async function downloadAppUpdate({ version, asar }: AppManifest) {
  const response = await fetch(`${releases}/v${version}/${appUpdateName(version)}.asar`);
  if (!response.ok) throw new Error(`Couldn't download the update (${response.status}).`);
  const data = Buffer.from(await response.arrayBuffer());
  if (data.length !== asar.size || createHash("sha256").update(data).digest("hex") !== asar.sha256)
    throw new Error("The downloaded update is damaged.");
  writeFileSync(next(), data);
}

export const appUpdateLeftOver = () => existsSync(next());
export const discardAppUpdate = () => rmSync(next(), { force: true });

// Runs in Couch's own exe as Node once this process exits. One rename replaces
// app.asar (MOVEFILE_REPLACE_EXISTING on Windows), so it is never missing; Core
// and its helpers may hold it a little longer, so it retries for a minute.
export const swapScript = `
process.noAsar = true;
const fs = require("fs"), path = require("path"), { spawn } = require("child_process");
const [pid, resources, relaunch] = process.argv.slice(1);
const asar = path.join(resources, "app.asar"), next = path.join(resources, "app.next");
const alive = () => { try { process.kill(Number(pid), 0); return true; } catch { return false; } };
let deadline;
const attempt = () => {
  if (alive()) return setTimeout(attempt, 250);
  deadline ??= Date.now() + 60000;
  try { fs.renameSync(next, asar); } catch { if (Date.now() < deadline) return setTimeout(attempt, 250); }
  // Couch itself must start as Electron, not as Node like this script.
  const { ELECTRON_RUN_AS_NODE, ...env } = process.env;
  if (relaunch) spawn(relaunch, [], { detached: true, stdio: "ignore", env }).unref();
};
attempt();
`;

// Replaces app.asar after Couch quits, and starts Couch again when relaunch is set.
// Resolves once the helper runs, so Couch quits only when someone will finish the update.
export function swapAppOnExit(relaunch: boolean) {
  const helper = spawn(
    process.execPath,
    [
      "-e",
      swapScript,
      String(process.pid),
      process.resourcesPath,
      relaunch ? process.execPath : "",
    ],
    {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    },
  );
  helper.unref();
  return new Promise<void>((resolve, reject) => {
    helper.once("spawn", resolve);
    helper.once("error", reject);
  });
}
