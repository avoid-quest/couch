import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { runInNewContext } from "node:vm";

const build = await Bun.build({ entrypoints: ["app/main.ts"], target: "node", format: "cjs", external: ["electron", "electron-updater", "ws"] });
if (!build.success) throw new AggregateError(build.logs, "Main build failed");
const main = await build.outputs[0]!.text();

function startup(platform: string) {
  const switches = new Map<string, string>();
  let beforeReady: Map<string, string> | undefined;
  const app = Object.assign(new EventEmitter(), {
    commandLine: { appendSwitch: (name: string, value: string) => switches.set(name, value) },
    getAppPath: () => "/test", getPath: () => "/test", getVersion: () => "0.4.0",
    setPath() {}, setAppUserModelId() {}, requestSingleInstanceLock: () => true,
    whenReady() { beforeReady = new Map(switches); return new Promise(() => {}); },
  });
  // Run the real startup with no filesystem, audio, network, windows or children.
  runInNewContext(main, {
    __dirname: "/test", Buffer, URL, console,
    process: { platform, env: { COUCH_DATA_DIR: "/test/data", COUCH_PORT: "4101" }, stdout: { write() {} }, stderr: { write() {} } },
    require(name: string) {
      if (name === "electron") return { app, autoUpdater: new EventEmitter(), ipcMain: { handle() {} } };
      if (name === "electron-updater" || name === "ws") return {};
      if (name === "node:sqlite") return { DatabaseSync: class { constructor() { throw new Error("No database"); } } };
      if (name === "node:fs") return {
        readFileSync(path: string) {
          if (path === "/test/package.json") return '{"identifier":"test.couch"}';
          throw new Error("No saved state");
        },
        mkdirSync() {}, writeFileSync() {}, renameSync() {}, rmSync() {},
        openSync() { throw new Error("No log file"); },
      };
      if (name === "node:os") return { homedir: () => "/test" };
      if (["node:crypto", "node:path", "node:util"].includes(name)) return require(name);
      if (["node:dns/promises", "node:net", "node:tls", "node:timers/promises", "node:child_process"].includes(name)) return {};
      throw new Error(`Unexpected import ${name}`);
    },
  });
  expect(beforeReady).toBeDefined();
  return beforeReady!;
}

test("macOS requests 128 audio frames before Electron is ready", () => {
  expect(startup("darwin").get("audio-buffer-size")).toBe("128");
});

test.each(["linux", "win32"])("%s retains its default audio buffer", platform => {
  expect(startup(platform).has("audio-buffer-size")).toBe(false);
});
