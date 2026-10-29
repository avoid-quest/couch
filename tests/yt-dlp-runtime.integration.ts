// Optional real yt-dlp + runtimes; no website requests. Run under Node, as Core does.
import assert from "node:assert/strict";
import { test } from "node:test";
import cp from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startHelpers, helper } from "../src/server/helpers";
import { runYtDlp } from "../src/server/yt-dlp";
import fixture from "./fixtures/youtube-runtime-extractor.py" with { type: "text" };

const ytDlp = process.env.COUCH_TEST_YT_DLP, qjs = process.env.COUCH_TEST_QJS;
test("Core configures real yt-dlp to use restricted Node, Electron as Node, and QuickJS fallback", { skip: !ytDlp || !qjs, timeout: 30_000 }, async t => {
  const directory = mkdtempSync(join(tmpdir(), "couch-extractor-runtime-")), root = join(directory, "helpers");
  const before = { PATH: process.env.PATH, COUCH_DATA_DIR: process.env.COUCH_DATA_DIR, COUCH_NODE_PATH: process.env.COUCH_NODE_PATH, SSL_CERT_FILE: process.env.SSL_CERT_FILE };
  const execFile = cp.execFile, spawn = cp.spawn, versions = new Map<string, string>();
  for (const [name, version] of [["yt-dlp", "2099.01.01"], ["qjs", "0.17.0"], ["ffmpeg", "ffmpeg version 9.0.2"]]) {
    const path = join(root, name!, "fixture", process.platform === "win32" ? "helper.exe" : "helper");
    mkdirSync(join(root, name!, "fixture"), { recursive: true }); writeFileSync(path, "fixture", { mode: 0o755 }); versions.set(path, version!);
  }
  process.env.PATH = ""; process.env.COUCH_DATA_DIR = directory;
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Offline fixture"); });
  t.mock.method(cp, "execFile", (file: string, args: string[], options: object, callback: (...args: unknown[]) => void) => versions.has(file)
    ? execFile(process.execPath, ["-e", `console.log(${JSON.stringify(versions.get(file))})`], options, callback) : execFile(file, args, options, callback));
  t.mock.method(cp, "spawn", (file: string, args: string[], options: cp.SpawnOptions) => {
    if (!versions.has(file)) return spawn(file, args, options);
    assert.equal(options.env?.ELECTRON_RUN_AS_NODE, "1");
    assert.ok(args.includes(`node:${process.env.COUCH_NODE_PATH ?? process.execPath}`));
    assert.ok(args.some(arg => arg.startsWith("quickjs:")), "QuickJS stays configured as fallback");
    return spawn(ytDlp!, args.map(arg => arg.startsWith("quickjs:") ? `quickjs:${qjs}` : arg), options);
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll(); syncBuiltinESMExports();
    for (const [key, value] of Object.entries(before)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    rmSync(directory, { recursive: true, force: true });
  });
  const plugin = join(directory, "plugins", "bundled", "yt_dlp_plugins", "extractor");
  mkdirSync(plugin, { recursive: true }); writeFileSync(join(plugin, "runtime.py"), fixture);
  startHelpers(root); await Promise.all([helper("yt-dlp"), helper("qjs"), helper("ffmpeg")]);
  const cases = [undefined, ...process.env.COUCH_TEST_ELECTRON ? [process.env.COUCH_TEST_ELECTRON] : [], join(directory, "missing-node")];
  for (const node of cases) {
    if (node === undefined) delete process.env.COUCH_NODE_PATH; else process.env.COUCH_NODE_PATH = node;
    const expected = node === join(directory, "missing-node") ? "quickjs" : "node";
    const output = await runYtDlp(["--plugin-dirs", join(directory, "plugins"), "--use-extractors", "CouchRuntimeTest,end", "--dump-single-json", "--", `couchruntime:${expected}`]);
    assert.equal(JSON.parse(output).title, expected);
  }
});
