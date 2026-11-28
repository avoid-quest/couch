import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { NsisUpdater } from "electron-updater/out/NsisUpdater";

const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
const resourcesPath = Object.getOwnPropertyDescriptor(process, "resourcesPath");
const nativeEvents = new EventEmitter();
let windowsUpdater: NsisUpdater | undefined;
let shellError: string;
let appQuits: number;
const app = Object.assign(new EventEmitter(), {
  isPackaged: false,
  getVersion: () => "0.3.0",
  quit: () => appQuits++,
});
let available: string | null;
let disabled: boolean;
let checkError: Error | null;
let installError: Error | null;
let downloadError: Error | null;
let downloads: string[];
let armed: boolean[];
let temporary: string;
let starts: string[][];
let installs: number;
let swaps: string[][];
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
    if (downloadError) throw downloadError;
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
  session: { fromPartition: () => ({ fetch: (url: string) => globalThis.fetch(url) }) },
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
  spawn(command: string, args: string[]) {
    swaps.push([command, ...args.slice(2)]);
    const helper = Object.assign(new EventEmitter(), { unref() {} });
    setImmediate(() => helper.emit("spawn"));
    return helper;
  },
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
  appQuits = 0;
  swaps = [];
  available = null;
  disabled = false;
  checkError = null;
  installError = null;
  downloadError = null;
  windowsUpdater = undefined;
  shellError = "";
  app.isPackaged = false;
  // The Package job runs these on Windows too; only the app-only tests act as Windows.
  Object.defineProperty(process, "platform", { configurable: true, value: "linux" });
  app.removeAllListeners();
  autoUpdater.removeAllListeners();
  autoUpdater.on("error", () => {}); // electron-updater's own logging listener.
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  Object.defineProperty(process, "platform", platform);
  if (resourcesPath) Object.defineProperty(process, "resourcesPath", resourcesPath);
  else delete (process as Partial<NodeJS.Process>).resourcesPath;
  rmSync(temporary, { recursive: true, force: true });
});

const realFetch = globalThis.fetch;
const sha256 = (data: string) => createHash("sha256").update(data).digest("hex");
// A Windows release whose manifest lists `files`, serving `asar` as its app.asar.
const appRelease = (files: Record<string, string>, asar = "new app") => {
  Object.defineProperty(process, "platform", { configurable: true, value: "win32" });
  Object.defineProperty(process, "resourcesPath", { configurable: true, value: temporary });
  const requests: string[] = [];
  globalThis.fetch = (async (url: string) => {
    requests.push(url);
    if (url.endsWith(".app.json"))
      return Response.json({
        version: "0.3.1",
        asar: { sha256: sha256("new app"), size: 7 },
        files,
      });
    return new Response(asar);
  }) as typeof fetch;
  return requests;
};

test("Windows replaces only app.asar when a release changes nothing else", async () => {
  const requests = appRelease({});
  const updates = start();
  available = "0.3.1";
  await updates.check();
  expect(requests).toEqual([
    "https://github.com/avoid-quest/couch/releases/download/v0.3.1/Couch-0.3.1-x64.app.json",
    "https://github.com/avoid-quest/couch/releases/download/v0.3.1/Couch-0.3.1-x64.app.asar",
  ]);
  expect(downloads).toEqual([]);
  expect(readFileSync(join(temporary, "app.next"), "utf8")).toBe("new app");
  expect(updates.state()).toMatchObject({ status: "ready", available: "0.3.1", progress: null });
  await updates.action({ op: "install", version: "0.3.1" });
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(installs).toBe(0);
  expect(swaps).toEqual([[process.execPath, String(process.pid), temporary, process.execPath]]);
  expect(appQuits).toBe(1);
  app.emit("quit", {}, 0);
  expect(swaps.length).toBe(1);
});

test("Windows uses the installer when a release changes other files", async () => {
  appRelease({ "resources/live-relay/couch-relay.exe": sha256("new relay") });
  const updates = start();
  available = "0.3.1";
  await updates.check();
  expect(downloads).toEqual(["0.3.1"]);
  expect(existsSync(join(temporary, "app.next"))).toBe(false);
});

test("a Windows installer tried at Quit counts as refused if Couch starts on the old version", async () => {
  const requests = appRelease({ "resources/live-relay/couch-relay.exe": sha256("new relay") });
  const updates = start();
  available = "0.3.1";
  await updates.check();
  expect(updates.state().status).toBe("ready");
  // Even when Quit lands during a later check, the installer it runs is remembered.
  void updates.check();
  expect(updates.state().status).toBe("checking");
  app.emit("quit", {}, 0);
  app.removeAllListeners();
  const checked = requests.length;
  const reopened = start();
  await reopened.check();
  expect(downloads).toEqual(["0.3.1"]);
  expect(requests.length).toBe(checked);
  expect(reopened.state()).toMatchObject({ status: "error", available: null });
  expect(reopened.state().error).toContain("Windows blocked the update");
});

test("a Windows installer a failed download replaced isn't counted as refused at Quit", async () => {
  appRelease({ "resources/live-relay/couch-relay.exe": sha256("new relay") });
  const updates = start();
  available = "0.3.1";
  await updates.check();
  expect(updates.state().status).toBe("ready");
  // A Preview release without an app-only manifest, whose installer download fails.
  globalThis.fetch = (async () => new Response(null, { status: 404 })) as unknown as typeof fetch;
  available = "0.3.2-preview.1";
  downloadError = new Error("Connection reset");
  await updates.action({ op: "channel", channel: "preview" });
  await updates.check();
  expect(updates.state()).toMatchObject({
    status: "error",
    error: "Couldn't download the update. Try again later.",
  });
  app.emit("quit", {}, 0);
  expect(existsSync(join(temporary, "update-blocked"))).toBe(false);
});

test("a refused release that later installed is offered again", async () => {
  appRelease({});
  writeFileSync(join(temporary, "update-blocked"), app.getVersion());
  start();
  expect(existsSync(join(temporary, "update-blocked"))).toBe(false);
});

test("a damaged app.asar download is discarded", async () => {
  appRelease({}, "tampered");
  const updates = start();
  available = "0.3.1";
  await updates.check();
  expect(updates.state()).toMatchObject({ status: "error", available: null });
  expect(existsSync(join(temporary, "app.next"))).toBe(false);
});

test("a pending app.asar installs when Couch quits, without starting it again", async () => {
  appRelease({});
  const updates = start();
  available = "0.3.1";
  await updates.check();
  app.emit("quit", {}, 0);
  expect(swaps).toEqual([[process.execPath, String(process.pid), temporary, ""]]);
});

// Smart App Control fails the launch with UNKNOWN; a cancelled UAC prompt fails it with
// EACCES. Either way elevate.exe then exits 1, with no code of its own.
test.each([
  ["UNKNOWN", "error"],
  ["EACCES", "ready"],
])("a Windows %s launch that elevation can't rescue leaves the update %s", async (code, status) => {
  const requests = appRelease({ "resources/live-relay/couch-relay.exe": sha256("new relay") });
  const { updates, quits } = await windows(async (command) => {
    if (command === join(temporary, "elevate.exe"))
      throw new Error("Windows elevation helper failed to start the installer (1).");
    throw Object.assign(new Error(`spawn ${code}`), { code });
  });
  expect(updates.state().status).toBe("ready");
  await updates.action({ op: "install", version: "0.3.1" });
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(quits()).toBe(0);
  expect(updates.state().status).toBe(status);
  if (status === "ready") return;
  expect(updates.state()).toMatchObject({ available: null });
  expect(updates.state().error).toContain("Windows blocked the update");
  // Reopening Couch doesn't offer that release again.
  app.removeAllListeners();
  windowsUpdater!.removeAllListeners();
  const checked = requests.length;
  const reopened = start();
  await reopened.check();
  expect(requests.length).toBe(checked);
  expect(reopened.state()).toMatchObject({ status: "error", available: null });
});

// The script runs in Couch's exe as Node: Electron's own binary runs it here the same way.
const electronPackage = require.resolve("electron/package.json");
const electron = join(
  dirname(electronPackage),
  "dist",
  readFileSync(join(dirname(electronPackage), "path.txt"), "utf8"),
);
test("the swap waits for Couch to exit, replaces app.asar and starts Couch again", async () => {
  const { swapScript } = await import("../app/app-update");
  writeFileSync(join(temporary, "app.asar"), "old app");
  writeFileSync(join(temporary, "app.next"), "new app");
  // The stand-in Couch records whether it starts as Node; a shell script stands in only off Windows.
  const posix = platform.value !== "win32";
  const started = join(temporary, "started");
  const relaunch = join(temporary, "relaunch.sh");
  writeFileSync(relaunch, `#!/bin/sh\necho "node=$ELECTRON_RUN_AS_NODE" > "${started}"\n`, {
    mode: 0o755,
  });
  // The stand-in Couch runs until the test ends it, so the first check can't race its exit.
  const couch = Bun.spawn([process.execPath, "-e", "setInterval(() => {}, 1000)"]);
  const swap = Bun.spawn(
    [electron, "-e", swapScript, String(couch.pid), temporary, posix ? relaunch : ""],
    { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } },
  );
  try {
    await Bun.sleep(300);
    expect(readFileSync(join(temporary, "app.asar"), "utf8")).toBe("old app");
  } finally {
    couch.kill();
  }
  await couch.exited;
  expect(await swap.exited).toBe(0);
  expect(readFileSync(join(temporary, "app.asar"), "utf8")).toBe("new app");
  expect(existsSync(join(temporary, "app.next"))).toBe(false);
  expect(existsSync(join(temporary, "app.asar.old"))).toBe(false);
  if (!posix) return;
  while (!existsSync(started)) await Bun.sleep(20);
  expect(readFileSync(started, "utf8").trim()).toBe("node=");
});

// Exercise electron-updater's actual NSIS launch and quit logic on any host.
const windows = async (spawn?: (command: string, args: string[]) => Promise<boolean>) => {
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
    ...(spawn && { spawnLog: spawn }),
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

test("a Windows elevation helper must accept the installer before Couch quits", async () => {
  const { updates, quits, quitting } = await windows();
  const spawn = childProcess.spawn;
  let exitCode = 1;
  const launcher = spyOn(childProcess, "spawn").mockImplementation((command, args, options) => {
    if (command !== join(temporary, "elevate.exe"))
      throw Object.assign(new Error("Permission required"), { code: "EACCES" });
    expect(args).toEqual([join(temporary, "installer.exe"), "--updated", "/S", "--force-run"]);
    return spawn(process.execPath, ["-e", `process.exit(${exitCode})`], options);
  });
  try {
    const failed = new Promise<void>((resolve) => windowsUpdater!.once("error", () => resolve()));
    await updates.action({ op: "install", version: "0.3.1" });
    await Promise.race([failed, quitting]);
    expect(quits()).toBe(0);
    expect(updates.state().status).toBe("ready");
    expect(updates.state().error).toContain("Couldn't install");
    exitCode = 0;
    await updates.action({ op: "install", version: "0.3.1" });
    await quitting;
    expect(quits()).toBe(1);
  } finally {
    launcher.mockRestore();
  }
});

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
