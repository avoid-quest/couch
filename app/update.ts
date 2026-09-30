import { app, Notification } from "electron";
import updater from "electron-updater";
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import type { UpdateChannel, UpdateState } from "../src/shared/app-bridge";

// package.json build.publish: the public repo electron-updater reads.
const releases = "https://github.com/avoid-quest/couch-releases/releases/download";
const every = 4 * 60 * 60 * 1000;
// The channel this build was released on (scripts/package.ts).
const own: UpdateChannel = /-preview\.\d+$/.test(app.getVersion()) ? "preview" : "latest";

type Options = {
  channelPath: string;
  tv: boolean;
  onState(state: UpdateState): void;
};

// Checks at start and every 4 hours on the chosen channel, the build's own by
// default. electron-updater downloads and installs on Windows and Linux. On
// macOS it installs through Squirrel.Mac, which only updates signed apps, and
// Couch is unsigned, so there Couch swaps its own bundle when it quits, as the
// Tauri app did. The TV runs as an account that can't install packages: root's
// couch-update.timer installs overnight while nothing plays, and Restart to
// update starts couch-update@<version>.service (docs/native-tv.md).
export function startUpdates({ channelPath, tv, onState }: Options) {
  const { autoUpdater } = updater;
  const mac = process.platform === "darwin";
  // Keep a ready installer until it is used; a replacement download clears
  // electron-updater's pending cache even when that download fails.
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  let saved: string | null = null;
  try { saved = readFileSync(channelPath, "utf8").trim(); } catch {}
  let state: UpdateState = { version: app.getVersion(), channel: saved === "latest" || saved === "preview" ? saved : own, status: "idle", available: null, progress: null, checkedAt: null, error: null };
  const set = (next: Partial<UpdateState>) => { state = { ...state, ...next }; onState(state); return state; };
  const follow = (channel: UpdateChannel) => {
    autoUpdater.channel = channel;
    autoUpdater.allowPrerelease = channel === "preview";
    // Leaving previews for stable goes back to an older version; joining previews never does.
    autoUpdater.allowDowngrade = channel === "latest" && own === "preview";
  };
  follow(state.channel);

  let bundle: string | null = null;
  let relaunch = false;
  let notified: string | null = null;
  const ready = (version: string) => {
    autoUpdater.autoInstallOnAppQuit = !mac && !tv;
    set({ status: "ready", available: version, progress: null });
    if (tv || notified === version) return;
    notified = version;
    new Notification({ title: `Couch ${version} is ready`, body: "Restart Couch to update, or it updates when you quit." }).show();
  };
  autoUpdater.on("download-progress", ({ percent }) => set({ progress: Math.round(percent) }));
  autoUpdater.on("update-downloaded", ({ version }) => ready(version));
  autoUpdater.on("error", () => {
    if (state.status === "installing") set({ status: "ready", error: "Couldn't install the update. Try again later." });
  });
  if (mac) app.once("quit", () => { if (bundle) swap(process.pid, bundle, resolve(app.getPath("exe"), "../../.."), relaunch); });

  async function install(expected?: string, delay = 0) {
    if (state.status !== "ready") { if (expected) throw new Error("The available update changed. Check again."); return; }
    if (expected && state.available !== expected) throw new Error("The available update changed. Check again.");
    set({ status: "installing", error: null });
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    if (!tv) {
      relaunch = true;
      if (mac) app.quit(); else autoUpdater.quitAndInstall(true, true);
      return;
    }
    // Root installs the release and restarts the TV app.
    await promisify(execFile)("systemctl", ["start", "--no-block", `couch-update@${state.available}.service`]).catch(error => {
      console.error(`Couldn't start the TV update: ${error.message}`);
      set({ status: "ready", error: "This TV can't install updates yet. Run sudo couch-setup --tv once." });
    });
  }

  async function run() {
    if (state.status === "installing") return state;
    if (!app.isPackaged) return set({ status: "error", error: "Only the installed app updates." });
    const waiting = state.status === "ready" ? state.available : null;
    set({ status: "checking", error: null });
    try {
      const result = await autoUpdater.checkForUpdates();
      const found = result?.isUpdateAvailable ? result.updateInfo : null;
      set({ checkedAt: Date.now() });
      if (waiting && !tv) ready(waiting);
      else if (!found) return set({ status: "up-to-date", available: null });
      else if (!mac && !tv) {
        set({ status: "downloading", available: found.version, progress: 0 });
        await autoUpdater.downloadUpdate();
      } else if (mac) {
        set({ status: "downloading", available: found.version, progress: 0 });
        const zip = found.files.find(file => file.url.endsWith(".zip"));
        if (!zip) throw new Error(`${found.version} has no Mac zip`);
        const next = await download(`${releases}/v${found.version}/${zip.url}`, zip.sha512, progress => set({ progress }));
        if (bundle) await rm(dirname(bundle), { recursive: true, force: true });
        bundle = next;
        ready(found.version);
      } else ready(found.version);
    } catch (error) {
      console.error(`Update failed: ${error instanceof Error ? error.message : error}`);
      const code = (error as { code?: string }).code ?? "";
      // An update downloaded earlier still installs.
      set({ status: waiting ? "ready" : "error", available: waiting, progress: null, error: state.status === "downloading" ? "Couldn't download the update. Try again later."
        : /LATEST_VERSION_NOT_FOUND|NO_PUBLISHED_VERSIONS|CHANNEL_FILE_NOT_FOUND/.test(code) ? "No release on this channel yet." : "Couldn't check for updates. Try again later." });
    }
    return state;
  }
  let running: Promise<UpdateState> | null = null;
  const check = () => running ??= run().finally(() => { running = null; });

  if (app.isPackaged) {
    void check();
    setInterval(() => void check(), every);
  }
  return {
    state: () => state,
    check,
    install,
    async setChannel(channel: unknown) {
      if (channel !== "latest" && channel !== "preview") throw new Error("Choose Stable or Preview.");
      if (running || ["checking", "downloading", "installing"].includes(state.status)) throw new Error("Wait for the update to finish.");
      if (channel === state.channel) return state;
      writeFileSync(channelPath, channel);
      autoUpdater.autoInstallOnAppQuit = false;
      const previous = bundle;
      bundle = null;
      follow(channel);
      set({ channel, status: "checking", available: null, progress: null, error: null });
      if (previous) await rm(dirname(previous), { recursive: true, force: true }).catch(error => console.error(error));
      void check();
      return state;
    },
  };
}

// Downloads the zip into a temporary directory, checks it against the update
// file's sha512 and unpacks it there, returning the app bundle inside. A failed
// download removes the directory; after a good one, swap removes it.
export async function download(url: string, sha512: string, onProgress?: (percent: number) => void) {
  const dir = await mkdtemp(join(tmpdir(), "couch-update-"));
  try {
    const response = await fetch(url);
    if (!response.ok || !response.body) throw new Error(`${url} answered ${response.status}`);
    const total = Number(response.headers.get("content-length")) || 0;
    let received = 0;
    const hash = createHash("sha512");
    const zip = join(dir, "update.zip");
    await pipeline(response.body, async function* (chunks: AsyncIterable<Uint8Array>) {
      for await (const chunk of chunks) {
        hash.update(chunk);
        received += chunk.length;
        if (total) onProgress?.(Math.round(received / total * 100));
        yield chunk;
      }
    }, createWriteStream(zip));
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
// running one is (restoring the old one if that fails), removes the rest and,
// when asked to relaunch, opens Couch again.
export function swap(pid: number, bundle: string, current: string, relaunch = false) {
  const script = 'while kill -0 "$0" 2>/dev/null; do sleep 0.5; done; dir=$(dirname "$1"); mv "$2" "$dir/old.app" && { mv "$1" "$2" || mv "$dir/old.app" "$2"; }; rm -rf "$dir"; [ -z "$3" ] || open "$2"';
  spawn("/bin/sh", ["-c", script, String(pid), bundle, current, relaunch ? "1" : ""], { detached: true, stdio: "ignore" }).unref();
}
