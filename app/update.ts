import { app, Notification } from "electron";
import updater from "electron-updater";
import { execFile } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { promisify } from "node:util";
import { isUpdateChannel, isUpdateVersion, parseUpdateOutcome, validateUpdateAction, UPDATE_INTERRUPTS_PLAYBACK, type UpdateChannel, type UpdateOutcome, type UpdateState } from "../src/shared/updates";
import { appDiagnostic, logAppError } from "./diagnostics";

const every = 4 * 60 * 60 * 1000;
// The channel this build was released on (scripts/package.ts).
const own: UpdateChannel = /-preview\.\d+$/.test(app.getVersion()) ? "preview" : "latest";
// The TV's root update script and where it records each run (packaging/tv).
const units = ["/usr/lib/systemd/system/couch-update@.service", "/usr/lib/systemd/system/couch-update.timer"];
const statusPath = "/var/lib/couch-update/status";

type Options = {
  channelPath: string;
  tv: boolean;
  onState(state: UpdateState): void;
  playing?: () => boolean | Promise<boolean>;
};

// Checks at start and every 4 hours on the chosen channel, the build's own by
// default. electron-updater downloads and installs, through Squirrel.Mac on
// macOS, which takes only builds signed like the running one (docs/ci.md).
// The TV runs as an account that can't install packages: root's
// couch-update.timer installs overnight while nothing plays, and Restart to
// update starts couch-update@<version>.service (docs/native-tv.md).
export function startUpdates({ channelPath, tv, onState, playing }: Options) {
  const { autoUpdater } = updater;
  // Its default console logger prints raw URLs and stacks before our error handler.
  autoUpdater.logger = {
    info: message => console.log(appDiagnostic("update", "info", message)),
    warn: message => console.warn(appDiagnostic("update", "warning", message)),
    error: message => logAppError("update", message),
  };
  // Keep a ready installer until it is used; a replacement download clears
  // electron-updater's pending cache even when that download fails.
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  let saved: string | null = null;
  try { saved = readFileSync(channelPath, "utf8").trim(); } catch {}
  let state: UpdateState = { version: app.getVersion(), channel: isUpdateChannel(saved) ? saved : own, status: "idle", available: null, progress: null, checkedAt: null, error: null };
  const set = (next: Partial<UpdateState>) => { state = { ...state, ...next }; onState(state); return state; };
  const follow = (channel: UpdateChannel) => {
    autoUpdater.channel = channel;
    autoUpdater.allowPrerelease = channel === "preview";
    // Leaving previews for stable goes back to an older version; joining previews never does.
    autoUpdater.allowDowngrade = channel === "latest" && own === "preview";
  };
  follow(state.channel);

  // On the TV, the root script's last run, read at each check and when it
  // changes. A failed run for the release being installed ends Installing….
  let installing = 0;
  const automatic = async () => {
    const active = await promisify(execFile)("systemctl", ["is-active", "--quiet", "couch-update.timer"]).then(() => true, () => false);
    const last = lastOutcome();
    const failed = state.status === "installing" && last?.version === state.available && last.at >= installing && (last.outcome === "failed" || last.outcome === "rolled-back");
    set({ automatic: { installed: units.every(unit => existsSync(unit)), active, last }, ...failed && { status: "ready", error: last.error ?? `Couch ${last.version} didn't install.` } });
  };
  if (tv) {
    void automatic();
    setInterval(() => void automatic(), 10_000).unref();
  }

  let notified: string | null = null;
  const ready = (version: string) => {
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

  async function install(expected: string, delay: number, interrupt = false) {
    if (state.status !== "ready" || state.available !== expected) throw new Error("The available update changed. Check again.");
    if (tv) installing = Math.floor(Date.now() / 1000) * 1000;
    set({ status: "installing", error: null });
    try {
      if (!interrupt && await playing?.()) throw new Error(UPDATE_INTERRUPTS_PLAYBACK);
    } catch (error) {
      set({ status: "ready", error: error instanceof Error ? error.message : "Couldn't check playback. Try again." });
      throw error;
    }
    void finishInstall(expected, delay, interrupt).catch(error => {
      set({ status: "ready", error: error instanceof Error ? error.message : "Couldn't install the update. Try again later." });
      logAppError("update", `Couldn't install the update: ${error.message}`);
    });
  }

  async function finishInstall(version: string, delay: number, interrupt: boolean) {
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    if (!interrupt && await playing?.()) throw new Error(UPDATE_INTERRUPTS_PLAYBACK);
    if (!tv) return autoUpdater.quitAndInstall(true, true);
    // Root installs the release and restarts the TV app.
    await promisify(execFile)("systemctl", ["start", "--no-block", `couch-update@${version}.service`]).catch(error => {
      logAppError("update", `Couldn't start the TV update: ${error.message}`);
      set({ status: "ready", error: "This TV can't install updates yet. Run sudo couch-setup --tv once." });
    });
  }

  async function run() {
    if (state.status === "installing") return state;
    if (!app.isPackaged) return set({ status: "error", error: "Only the installed app updates." });
    const waiting = state.status === "ready" ? state.available : null;
    set({ status: "checking", error: null });
    try {
      if (tv) await automatic();
      const result = await autoUpdater.checkForUpdates();
      const found = result?.isUpdateAvailable ? result.updateInfo : null;
      if (found && !isUpdateVersion(found.version)) throw new Error("Invalid update version.");
      set({ checkedAt: Date.now() });
      if (waiting && !tv) ready(waiting);
      else if (!found) return set({ status: "up-to-date", available: null });
      else if (!tv) {
        set({ status: "downloading", available: found.version, progress: 0 });
        // Updates install on quit only if this is on when their download finishes.
        autoUpdater.autoInstallOnAppQuit = true;
        await autoUpdater.downloadUpdate();
      } else ready(found.version);
    } catch (error) {
      logAppError("update", `Update failed: ${error instanceof Error ? error.message : error}`);
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
  async function setChannel(channel: UpdateChannel) {
    if (running || ["checking", "downloading", "installing"].includes(state.status)) throw new Error("Wait for the update to finish.");
    if (channel === state.channel) return state;
    writeFileSync(channelPath, channel);
    // Squirrel.Mac still installs an update it staged; the next check corrects the channel.
    autoUpdater.autoInstallOnAppQuit = false;
    follow(channel);
    set({ channel, status: "checking", available: null, progress: null, error: null });
    void check();
    return state;
  }
  return {
    state: () => state,
    check,
    // Validate and reserve in the updater owner, before any asynchronous work.
    // Main allows transport replies to leave by passing an install delay.
    async action(action: unknown, installDelay = 0): Promise<UpdateState> {
      validateUpdateAction(action);
      if (action.op === "check") void check();
      else if (action.op === "channel") return setChannel(action.channel);
      else if (action.op === "install") await install(action.version, installDelay, action.interrupt);
      return state;
    },
  };
}

// KEY=value lines from the TV's update script; null when absent or garbled.
function lastOutcome(): UpdateOutcome | null {
  try { return parseUpdateOutcome(readFileSync(statusPath, "utf8")); } catch { return null; }
}
