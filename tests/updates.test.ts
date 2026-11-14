import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { NsisUpdater } from "electron-updater/out/NsisUpdater";

const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
const resourcesPath = Object.getOwnPropertyDescriptor(process, "resourcesPath");
const nativeEvents = new EventEmitter();
let windowsUpdater: NsisUpdater | undefined;
let shellError: string;
const app = Object.assign(new EventEmitter(), {
  isPackaged: false,
  getVersion: () => "0.3.0",
});
let available: string | null;
let disabled: boolean;
let checkError: Error | null;
let installError: Error | null;
let downloads: string[];
let armed: boolean[];
let temporary: string;
let starts: string[][];
let installs: number;
const autoUpdater = Object.assign(new EventEmitter(), {
  logger: null as {
    info(message: unknown): void;
    warn(message: unknown): void;
    error(message: unknown): void;
  } | null,
  channel: "latest",
  autoDownload: true,
  autoInstallOnAppQuit: true,
  async checkForUpdates() {
    if (checkError) throw checkError;
    if (disabled) return null;
    return {
      isUpdateAvailable: available !== null,
      updateInfo: { version: available, files: [] },
      downloadPromise:
        available && this.autoDownload
          ? new Promise((resolve) => setImmediate(() => this.downloadUpdate().then(resolve)))
          : null,
    };
  },
  async downloadUpdate() {
    downloads.push(available!);
    armed.push(this.autoInstallOnAppQuit);
    this.emit("update-downloaded", { version: available });
    return [];
  },
  quitAndInstall() {
    installs++;
    if (installError) this.emit("error", installError);
  },
});
mock.module("electron", () => ({
  app,
  autoUpdater: nativeEvents,
  shell: { openPath: async () => shellError },
  Notification: class {
    show() {}
  },
}));
mock.module("electron-updater", () => ({
  default: {
    get autoUpdater() {
      return windowsUpdater ?? autoUpdater;
    },
  },
}));
mock.module("node:child_process", () => ({
  execFile(
    command: string,
    args: string[],
    callback: (error: Error | null, stdout: string, stderr: string) => void,
  ) {
    if (command === "systemctl" && args[0] === "is-active") {
      callback(new Error("inactive"), "", "");
      return;
    }
    if (command === "systemctl" && args[0] === "start") starts.push(args);
    callback(null, "", "");
  },
}));
const { startUpdates } = await import("../app/update");
const start = () => {
  const updates = startUpdates({
    channelPath: join(temporary, "update-channel"),
    tv: false,
    onState() {},
  });
  app.isPackaged = true;
  return updates;
};

beforeEach(() => {
  temporary = mkdtempSync(join(tmpdir(), "couch-update-test-"));
  downloads = [];
  armed = [];
  starts = [];
  installs = 0;
  available = null;
  disabled = false;
  checkError = null;
  installError = null;
  windowsUpdater = undefined;
  shellError = "";
  app.isPackaged = false;
  app.removeAllListeners();
  autoUpdater.removeAllListeners();
  autoUpdater.on("error", () => {}); // electron-updater's own logging listener.
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
});
afterEach(() => {
  Object.defineProperty(process, "platform", platform);
  if (resourcesPath) Object.defineProperty(process, "resourcesPath", resourcesPath);
  else delete (process as Partial<NodeJS.Process>).resourcesPath;
  rmSync(temporary, { recursive: true, force: true });
});

// Exercise electron-updater's actual NSIS launch and quit logic on any host.
const windows = async (spawn: (command: string, args: string[]) => Promise<boolean>) => {
  Object.defineProperty(process, "resourcesPath", { configurable: true, value: temporary });
  let quits = 0;
  const quitting = Promise.withResolvers<void>();
  windowsUpdater = new NsisUpdater(null, {
    version: "0.3.0",
    name: "Couch",
    isPackaged: true,
    appUpdateConfigPath: join(temporary, "app-update.yml"),
    userDataPath: temporary,
    baseCachePath: temporary,
    whenReady: async () => {},
    relaunch() {},
    quit() {
      quits++;
      quitting.resolve();
    },
    onQuit() {},
  });
  Object.assign(windowsUpdater, {
    downloadedUpdateHelper: {
      file: join(temporary, "installer.exe"),
      downloadedFileInfo: {},
    },
    checkForUpdates: autoUpdater.checkForUpdates,
    async downloadUpdate() {
      windowsUpdater!.emit("update-downloaded", { version: available });
      return [];
    },
    spawnLog: spawn,
  });
  const updates = start();
  available = "0.3.1";
  await updates.check();
  return { updates, quits: () => quits, quitting: quitting.promise };
};

test.each(["UNKNOWN", "EACCES"])(
  "a Windows %s fallback keeps Couch reachable on failure and permits retry",
  async (code) => {
    const fallback = Promise.withResolvers<boolean>();
    let attempt = 0;
    const { updates, quits, quitting } = await windows(async (command, args) => {
      attempt++;
      if (attempt === 1) throw Object.assign(new Error(`spawn ${code}`), { code });
      if (attempt === 2) {
        expect(command).toBe(join(temporary, "elevate.exe"));
        expect(args).toEqual([join(temporary, "installer.exe"), "--updated", "/S", "--force-run"]);
        return fallback.promise;
      }
      return true;
    });
    try {
      await updates.action({ op: "install", version: "0.3.1" });
      await new Promise(setImmediate);
      expect(quits()).toBe(0);
      expect((await updates.action({ op: "read" })).status).toBe("installing");
      await expect(updates.action({ op: "install", version: "0.3.1" })).rejects.toThrow();
      fallback.reject(new Error("Elevation failed"));
      await new Promise(setImmediate);
      expect(quits()).toBe(0);
      expect(updates.state().status).toBe("ready");
      expect(updates.state().error).toContain("Couldn't install");
      await updates.action({ op: "install", version: "0.3.1" });
      await quitting;
      expect(attempt).toBe(3);
      expect(quits()).toBe(1);
    } finally {
      fallback.resolve(true);
      await new Promise(setImmediate);
    }
  },
);

test("a Windows shell launch error does not quit Couch or strand Installing", async () => {
  shellError = "No application could open the installer";
  const { updates, quits } = await windows(async () => {
    throw Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" });
  });
  await updates.action({ op: "install", version: "0.3.1" });
  await new Promise(setImmediate);
  expect(quits()).toBe(0);
  expect(updates.state().status).toBe("ready");
  expect(updates.state().error).toContain("Couldn't install");
});

test("a pending Windows fallback launches once and quits only after it succeeds", async () => {
  const fallback = Promise.withResolvers<boolean>();
  let attempts = 0;
  const { updates, quits, quitting } = await windows(async () => {
    if (++attempts === 1) throw Object.assign(new Error("spawn UNKNOWN"), { code: "UNKNOWN" });
    return fallback.promise;
  });
  try {
    await updates.action({ op: "install", version: "0.3.1" });
    await new Promise(setImmediate);
    windowsUpdater!.quitAndInstall(true, true);
    expect(attempts).toBe(2);
    expect(quits()).toBe(0);
  } finally {
    fallback.resolve(true);
    await quitting;
  }
  expect(quits()).toBe(1);
});

test("retrying a failed Windows launch starts the installer again", async () => {
  let attempts = 0;
  const { updates } = await windows(async () => {
    if (++attempts === 1) throw Object.assign(new Error("spawn EPERM"), { code: "EPERM" });
    return true;
  });
  await updates.action({ op: "install", version: "0.3.1" });
  await new Promise(setImmediate);
  await updates.action({ op: "install", version: "0.3.1" });
  await new Promise(setImmediate);
  expect(attempts).toBe(2);
});

test("a successful Windows launch keeps silent restart arguments and quits once", async () => {
  const { updates, quits, quitting } = await windows(async (_command, args) => {
    expect(args).toEqual(["--updated", "/S", "--force-run"]);
    return true;
  });
  await updates.action({ op: "install", version: "0.3.1" });
  await quitting;
  expect(quits()).toBe(1);
});

test("a downloaded update installs when Couch quits, on macOS as elsewhere", async () => {
  Object.defineProperty(process, "platform", { ...platform, value: "darwin" });
  const updates = start();
  available = "0.3.1";
  await updates.check();
  expect(updates.state().status).toBe("ready");
  expect(armed).toEqual([true]);
});

test("a disabled native updater cannot report a successful check", async () => {
  const updates = start();
  disabled = true;
  await updates.check();
  expect(updates.state().status).toBe("error");
  expect(updates.state().checkedAt).toBeNull();
  expect(updates.state().available).toBeNull();
  expect(downloads).toEqual([]);
});

test("manual installation checks playback in its owner and needs explicit interruption", async () => {
  const updates = startUpdates({
    channelPath: join(temporary, "update-channel"),
    tv: false,
    onState() {},
    playing: () => true,
  });
  app.isPackaged = true;
  available = "0.3.1";
  await updates.check();
  await expect(updates.action({ op: "install", version: "0.3.1" })).rejects.toThrow(
    "Stop playback and update",
  );
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
  checkError = Object.assign(new Error("No Stable release"), {
    code: "ERR_UPDATER_LATEST_VERSION_NOT_FOUND",
  });
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
  await expect(updates.action({ op: "install", version: "0.3.2" })).rejects.toThrow(
    "available update changed",
  );
  expect(updates.state().status).toBe("ready");
});

test("malformed actions and release versions cannot invoke the native installer", async () => {
  Object.defineProperty(process, "platform", { ...platform, value: "linux" });
  const updates = start();
  available = "0.3.1";
  await updates.check();
  for (const action of [
    null,
    { op: "unknown" },
    { op: "channel", channel: "nightly" },
    { op: "install" },
    { op: "install", version: "" },
    { op: "install", version: "0.3.1;reboot" },
    { op: "install", version: "1".repeat(81) },
  ]) {
    await expect(updates.action(action)).rejects.toThrow();
    expect(updates.state().status).toBe("ready");
  }
  expect(installs).toBe(0);
});

test("a malformed release feed never becomes a ready TV update", async () => {
  Object.defineProperty(process, "platform", { ...platform, value: "linux" });
  const updates = startUpdates({
    channelPath: join(temporary, "update-channel"),
    tv: true,
    onState() {},
  });
  app.isPackaged = true;
  available = "0.3.1;reboot";
  await updates.check();
  expect(updates.state().status).toBe("error");
  expect(updates.state().available).toBeNull();
  expect(starts).toEqual([]);
});

test("a delayed TV install keeps the reserved release and rejects competing actions", async () => {
  Object.defineProperty(process, "platform", { ...platform, value: "linux" });
  const updates = startUpdates({
    channelPath: join(temporary, "update-channel"),
    tv: true,
    onState() {},
  });
  app.isPackaged = true;
  available = "0.3.1-preview.2";
  await updates.action({ op: "channel", channel: "preview" });
  await updates.check();
  await expect(updates.action({ op: "install", version: "0.3.1-preview.1" })).rejects.toThrow(
    "available update changed",
  );
  expect(starts).toEqual([]);
  expect((await updates.action({ op: "install", version: "0.3.1-preview.2" }, 10)).status).toBe(
    "installing",
  );
  available = "0.3.2-preview.1";
  await updates.check();
  await expect(updates.action({ op: "channel", channel: "latest" })).rejects.toThrow(
    "Wait for the update",
  );
  await expect(updates.action({ op: "install", version: "0.3.1-preview.2" })).rejects.toThrow(
    "available update changed",
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(starts).toEqual([["start", "--no-block", "couch-update@0.3.1-preview.2.service"]]);
});
