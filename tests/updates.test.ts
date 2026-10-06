import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
const originalFetch = globalThis.fetch;
const app = Object.assign(new EventEmitter(), {
  isPackaged: false,
  getVersion: () => "0.3.0",
  getPath: () => "/unused/Couch.app/Contents/MacOS/couch",
  quit() { this.emit("quit"); },
});
const bytes = new Uint8Array([1, 2, 3]);
const sha512 = createHash("sha512").update(bytes).digest("base64");
let available: string | null;
let checkError: Error | null;
let installError: Error | null;
let downloads: string[];
let swaps: string[];
let temporary: string;
let bundles: string[];
let timerActive: boolean;
let delayedTimer: ((error: Error | null, stdout: string, stderr: string) => void) | null;
let delayTimer: boolean;
let starts: string[][];
let installs: number;
const autoUpdater = Object.assign(new EventEmitter(), {
  channel: "latest",
  autoDownload: true,
  autoInstallOnAppQuit: true,
  async checkForUpdates() {
    if (checkError) throw checkError;
    return {
      isUpdateAvailable: available !== null,
      updateInfo: { version: available, files: [{ url: "update.zip", sha512 }] },
      downloadPromise: available && this.autoDownload ? new Promise(resolve => setImmediate(() => this.downloadUpdate().then(resolve))) : null,
    };
  },
  async downloadUpdate() {
    downloads.push(available!);
    this.emit("update-downloaded", { version: available });
    return [];
  },
  quitAndInstall() { installs++; if (installError) this.emit("error", installError); },
});
mock.module("electron", () => ({ app, Notification: class { show() {} } }));
mock.module("electron-updater", () => ({ default: { autoUpdater } }));
mock.module("node:child_process", () => ({
  execFile(command: string, args: string[], callback: (error: Error | null, stdout: string, stderr: string) => void) {
    if (command === "systemctl" && args[0] === "is-active") { if (delayTimer) delayedTimer = callback; else callback(timerActive ? null : new Error("inactive"), "", ""); return; }
    if (command === "systemctl" && args[0] === "start") starts.push(args);
    if (command === "ditto") {
      const directory = args.at(-1)!;
      mkdirSync(join(directory, "Couch.app"));
      bundles.push(directory);
    }
    callback(null, "", "");
  },
  spawn(_command: string, args: string[]) { swaps.push(args[3]!); return { unref() {} }; },
}));
const { startUpdates } = await import("../app/update");
const start = () => {
  const updates = startUpdates({ channelPath: join(temporary, "update-channel"), tv: false, onState() {} });
  app.isPackaged = true;
  return updates;
};

beforeEach(() => {
  temporary = mkdtempSync(join(tmpdir(), "couch-update-test-"));
  bundles = []; downloads = []; swaps = [];
  starts = []; installs = 0;
  available = null; checkError = null; installError = null;
  timerActive = false;
  delayTimer = false; delayedTimer = null;
  app.isPackaged = false;
  app.removeAllListeners(); autoUpdater.removeAllListeners();
  autoUpdater.on("error", () => {}); // electron-updater's own logging listener.
  autoUpdater.autoDownload = true; autoUpdater.autoInstallOnAppQuit = true;
  globalThis.fetch = async () => new Response(bytes);
});
afterEach(() => {
  Object.defineProperty(process, "platform", platform);
  globalThis.fetch = originalFetch;
  for (const directory of [temporary, ...bundles]) rmSync(directory, { recursive: true, force: true });
});

test("returning to Stable discards the staged Mac Preview bundle", async () => {
  Object.defineProperty(process, "platform", { ...platform, value: "darwin" });
  const updates = start();
  available = "0.3.1-preview.1";
  await updates.action({ op: "channel", channel: "preview" });
  await updates.check();
  expect(updates.state().status).toBe("ready");
  available = null;
  await updates.action({ op: "channel", channel: "latest" });
  await updates.check();
  expect(updates.state().status).toBe("up-to-date");
  app.quit();
  expect(swaps).toEqual([]);
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

test("a same-channel check failure keeps its downloaded installer ready", async () => {
  Object.defineProperty(process, "platform", { ...platform, value: "linux" });
  const updates = start();
  available = "0.3.1";
  await updates.check();
  checkError = new Error("Offline");
  await updates.check();
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

test("remote installation reserves the version before acknowledging a restart", async () => {
  Object.defineProperty(process, "platform", { ...platform, value: "linux" });
  const updates = start();
  available = "0.3.1";
  await updates.check();
  const reply = await updates.action({ op: "install", version: "0.3.1" }, 10);
  expect(reply.status).toBe("installing");
  expect(installs).toBe(0);
  expect(updates.state().status).toBe("installing");
  await expect(updates.action({ op: "channel", channel: "preview" })).rejects.toThrow("Wait for the update");
  await updates.check();
  expect(updates.state().status).toBe("installing");
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(installs).toBe(1);
});

test("a remote restart rejects a stale available version", async () => {
  Object.defineProperty(process, "platform", { ...platform, value: "linux" });
  const updates = start();
  available = "0.3.1";
  await updates.check();
  await expect(updates.action({ op: "install", version: "0.3.2" })).rejects.toThrow("available update changed");
  expect(updates.state().status).toBe("ready");
});

test("an empty expected version cannot bypass the native install guard", async () => {
  Object.defineProperty(process, "platform", { ...platform, value: "linux" });
  const updates = start();
  available = "0.3.1";
  await updates.check();
  await expect(updates.action({ op: "install", version: "" })).rejects.toThrow("Choose the available update.");
  expect(updates.state().status).toBe("ready");
  expect(installs).toBe(0);
});

test("malformed actions and release versions cannot invoke the native installer", async () => {
  Object.defineProperty(process, "platform", { ...platform, value: "linux" });
  const updates = start();
  available = "0.3.1";
  await updates.check();
  for (const action of [null, [], { op: "unknown" }, { op: "channel", channel: "nightly" }, { op: "install" }, { op: "install", version: null }, { op: "install", version: "0.3.1;reboot" }, { op: "install", version: "1".repeat(81) }]) {
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

test("a TV check offers a newer release because root owns its package downloads", async () => {
  Object.defineProperty(process, "platform", { ...platform, value: "linux" });
  const updates = startUpdates({ channelPath: join(temporary, "update-channel"), tv: true, onState() {} });
  app.isPackaged = true;
  available = "0.3.1";
  await updates.check();
  available = "0.3.2";
  await updates.check();
  expect(updates.state().available).toBe("0.3.2");
  expect(downloads).toEqual([]);
});

test("an inactive TV timer is reported as off while manual updates remain ready", async () => {
  Object.defineProperty(process, "platform", { ...platform, value: "linux" });
  const updates = startUpdates({ channelPath: join(temporary, "update-channel"), tv: true, onState() {} });
  app.isPackaged = true;
  available = "0.3.1";
  await updates.check();
  expect(updates.state().automatic?.active).toBe(false);
  expect(updates.state().status).toBe("ready");
  timerActive = true;
  await updates.check();
  expect(updates.state().automatic?.active).toBe(true);
});

test("a TV check reserves its action before waiting for systemctl", async () => {
  Object.defineProperty(process, "platform", { ...platform, value: "linux" });
  const updates = startUpdates({ channelPath: join(temporary, "update-channel"), tv: true, onState() {} });
  app.isPackaged = true;
  available = "0.3.1";
  await updates.check();
  delayTimer = true;
  const check = updates.check();
  expect(updates.state().status).toBe("checking");
  await expect(updates.action({ op: "install", version: "0.3.1" })).rejects.toThrow("available update changed");
  delayedTimer!(null, "", "");
  await check;
  expect(updates.state().status).toBe("ready");
});
