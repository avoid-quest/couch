import { app, Notification } from "electron";
import updater from "electron-updater";
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";

// package.json build.publish: the public repo electron-updater reads.
const releases = "https://github.com/avoid-quest/couch-releases/releases/download";

// electron-updater follows the running version's channel: a -preview.N build
// reads preview-*.yml from the newest preview, any other build latest-*.yml.
// It installs on Windows and Linux. On macOS it installs through Squirrel.Mac,
// which only updates signed apps, and Couch is unsigned, so there Couch swaps
// its own bundle when it quits, as the Tauri app did.
export async function checkForUpdates() {
  const { autoUpdater } = updater;
  if (process.platform !== "darwin") {
    await autoUpdater.checkForUpdatesAndNotify();
    return;
  }
  autoUpdater.autoDownload = false;
  const result = await autoUpdater.checkForUpdates();
  const zip = result?.isUpdateAvailable ? result.updateInfo.files.find(file => file.url.endsWith(".zip")) : undefined;
  if (!result || !zip) return;
  const { version } = result.updateInfo;
  const bundle = await download(`${releases}/v${version}/${zip.url}`, zip.sha512);
  app.once("quit", () => swap(process.pid, bundle, resolve(app.getPath("exe"), "../../..")));
  new Notification({ title: `Couch ${version} is ready`, body: "It installs when you quit Couch." }).show();
}

// Downloads the zip into a temporary directory, checks it against the update
// file's sha512 and unpacks it there, returning the app bundle inside. A failed
// download removes the directory; after a good one, swap removes it.
export async function download(url: string, sha512: string) {
  const dir = await mkdtemp(join(tmpdir(), "couch-update-"));
  try {
    const response = await fetch(url);
    if (!response.ok || !response.body) throw new Error(`${url} answered ${response.status}`);
    const hash = createHash("sha512");
    const zip = join(dir, "update.zip");
    await pipeline(response.body, async function* (chunks: AsyncIterable<Uint8Array>) { for await (const chunk of chunks) { hash.update(chunk); yield chunk; } }, createWriteStream(zip));
    if (hash.digest("base64") !== sha512) throw new Error(`${url} doesn't match its sha512`);
    await promisify(execFile)("ditto", ["-x", "-k", zip, dir]);
    const name = (await readdir(dir)).find(entry => entry.endsWith(".app"));
    if (!name) throw new Error(`${url} holds no app`);
    return join(dir, name);
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
}

// A detached shell waits for Couch to exit, puts the new bundle where the
// running one is (restoring the old one if that fails) and removes the rest.
export function swap(pid: number, bundle: string, current: string) {
  const script = 'while kill -0 "$0" 2>/dev/null; do sleep 0.5; done; dir=$(dirname "$1"); mv "$2" "$dir/old.app" && { mv "$1" "$2" || mv "$dir/old.app" "$2"; }; rm -rf "$dir"';
  spawn("/bin/sh", ["-c", script, String(pid), bundle, current], { detached: true, stdio: "ignore" }).unref();
}
