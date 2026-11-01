import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
const app = Object.assign(new EventEmitter(), {
  isPackaged: false,
  getVersion: () => "0.3.0",
});
let available: string | null;
let checkError: Error | null;
let installError: Error | null;
let downloads: string[];
let armed: boolean[];
let temporary: string;
let starts: string[][];
let installs: number;
const autoUpdater = Object.assign(new EventEmitter(), {
  logger: null as { info(message: unknown): void; warn(message: unknown): void; error(message: unknown): void } | null,
  channel: "latest",
  autoDownload: true,
  autoInstallOnAppQuit: true,
  async checkForUpdates() {
    if (checkError) throw checkError;
    return {
      isUpdateAvailable: available !== null,
      updateInfo: { version: available, files: [] },
      downloadPromise: available && this.autoDownload ? new Promise(resolve => setImmediate(() => this.downloadUpdate().then(resolve))) : null,
    };
  },
  async downloadUpdate() {
    downloads.push(available!);
    armed.push(this.autoInstallOnAppQuit);
    this.emit("update-downloaded", { version: available });
    return [];
  },
  quitAndInstall() { installs++; if (installError) this.emit("error", installError); },
});
mock.module("electron", () => ({ app, Notification: class { show() {} } }));
mock.module("electron-updater", () => ({ default: { autoUpdater } }));
mock.module("node:child_process", () => ({
  execFile(command: string, args: string[], callback: (error: Error | null, stdout: string, stderr: string) => void) {
    if (command === "systemctl" && args[0] === "is-active") { callback(new Error("inactive"), "", ""); return; }
    if (command === "systemctl" && args[0] === "start") starts.push(args);
    callback(null, "", "");
  },
}));
const { startUpdates } = await import("../app/update");
const start = () => {
  const updates = startUpdates({ channelPath: join(temporary, "update-channel"), tv: false, onState() {} });
  app.isPackaged = true;
  return updates;
};

beforeEach(() => {
  temporary = mkdtempSync(join(tmpdir(), "couch-update-test-"));
  downloads = []; armed = [];
  starts = []; installs = 0;
  available = null; checkError = null; installError = null;
  app.isPackaged = false;
  app.removeAllListeners(); autoUpdater.removeAllListeners();
  autoUpdater.on("error", () => {}); // electron-updater's own logging listener.
  autoUpdater.autoDownload = true; autoUpdater.autoInstallOnAppQuit = true;
});
afterEach(() => {
  Object.defineProperty(process, "platform", platform);
  rmSync(temporary, { recursive: true, force: true });
});

test("a downloaded update installs when Couch quits, on macOS as elsewhere", async () => {
  Object.defineProperty(process, "platform", { ...platform, value: "darwin" });
  const updates = start();
  available = "0.3.1";
  await updates.check();
  expect(updates.state().status).toBe("ready");
  expect(armed).toEqual([true]);
});

test("manual installation checks playback in its owner and needs explicit interruption", async () => {
  const updates = startUpdates({ channelPath: join(temporary, "update-channel"), tv: false, onState() {}, playing: () => true });
  app.isPackaged = true;
  available = "0.3.1";
  await updates.check();
  await expect(updates.action({ op: "install", version: "0.3.1" })).rejects.toThrow("Stop playback and update");
  expect(installs).toBe(0);
  expect(updates.state().status).toBe("ready");
  await updates.action({ op: "install", version: "0.3.1", interrupt: true });
  expect(installs).toBe(1);
});

test("a missing Stable feed cannot offer the previous Preview release", async () => {
  Object.defineProperty(process, "platform", { ...platform, value: "linux" });
  const updates = start();
  available = "0.3.1-preview.1";
  await updates.action({ op: "channel", channel: "preview" });
  await updates.check();
  checkError = Object.assign(new Error("No Stable release"), { code: "ERR_UPDATER_LATEST_VERSION_NOT_FOUND" });
  await updates.action({ op: "channel", channel: "latest" });
  await updates.check();
  expect(updates.state().status).toBe("error");
  expect(updates.state().available).toBeNull();
  expect(autoUpdater.autoInstallOnAppQuit).toBe(false);
});

test("checks keep a downloaded installer instead of replacing its cache", async () => {
  Object.defineProperty(process, "platform", { ...platform, value: "linux" });
  const updates = start();
  available = "0.3.1";
  await updates.check();
  available = "0.3.2";
  await updates.check();
  expect(autoUpdater.autoDownload).toBe(false);
  expect(downloads).toEqual(["0.3.1"]);
  expect(updates.state().status).toBe("ready");
  expect(updates.state().available).toBe("0.3.1");
});

test("an installer error ends Installing and reaches Settings", async () => {
  Object.defineProperty(process, "platform", { ...platform, value: "linux" });
  const updates = start();
  available = "0.3.1";
  await updates.check();
  installError = new Error("Authentication was cancelled");
  await updates.action({ op: "install", version: "0.3.1" });
  expect(updates.state().status).toBe("ready");
  expect(updates.state().error).toBe("Couldn't install the update. Try again later.");
});

test("a remote restart rejects a stale available version", async () => {
  Object.defineProperty(process, "platform", { ...platform, value: "linux" });
  const updates = start();
  available = "0.3.1";
  await updates.check();
  await expect(updates.action({ op: "install", version: "0.3.2" })).rejects.toThrow("available update changed");
  expect(updates.state().status).toBe("ready");
});

test("malformed actions and release versions cannot invoke the native installer", async () => {
  Object.defineProperty(process, "platform", { ...platform, value: "linux" });
  const updates = start();
  available = "0.3.1";
  await updates.check();
  for (const action of [null, { op: "unknown" }, { op: "channel", channel: "nightly" }, { op: "install" }, { op: "install", version: "" }, { op: "install", version: "0.3.1;reboot" }, { op: "install", version: "1".repeat(81) }]) {
    await expect(updates.action(action)).rejects.toThrow();
    expect(updates.state().status).toBe("ready");
  }
  expect(installs).toBe(0);
});

test("a malformed release feed never becomes a ready TV update", async () => {
  Object.defineProperty(process, "platform", { ...platform, value: "linux" });
  const updates = startUpdates({ channelPath: join(temporary, "update-channel"), tv: true, onState() {} });
  app.isPackaged = true;
  available = "0.3.1;reboot";
  await updates.check();
  expect(updates.state().status).toBe("error");
  expect(updates.state().available).toBeNull();
  expect(starts).toEqual([]);
});

test("a delayed TV install keeps the reserved release and rejects competing actions", async () => {
  Object.defineProperty(process, "platform", { ...platform, value: "linux" });
  const updates = startUpdates({ channelPath: join(temporary, "update-channel"), tv: true, onState() {} });
  app.isPackaged = true;
  available = "0.3.1-preview.2";
  await updates.action({ op: "channel", channel: "preview" });
  await updates.check();
  await expect(updates.action({ op: "install", version: "0.3.1-preview.1" })).rejects.toThrow("available update changed");
  expect(starts).toEqual([]);
  expect((await updates.action({ op: "install", version: "0.3.1-preview.2" }, 10)).status).toBe("installing");
  available = "0.3.2-preview.1";
  await updates.check();
  await expect(updates.action({ op: "channel", channel: "latest" })).rejects.toThrow("Wait for the update");
  await expect(updates.action({ op: "install", version: "0.3.1-preview.2" })).rejects.toThrow("available update changed");
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(starts).toEqual([["start", "--no-block", "couch-update@0.3.1-preview.2.service"]]);
});
