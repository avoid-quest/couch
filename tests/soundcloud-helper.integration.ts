import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { startHelpers } from "../src/server/helpers";
import { runYtDlp } from "../src/server/yt-dlp";
import { soundCloudPlugin } from "../src/server/soundcloud";
import fixture from "./fixtures/soundcloud-extractor.py" with { type: "text" };

test("SoundCloud keeps yt-dlp's client cache inside Couch and loads only its bundled plugin", { skip: process.platform === "win32" }, async t => {
  const directory = mkdtempSync(join(tmpdir(), "couch-soundcloud-")), bin = join(directory, "bin");
  mkdirSync(bin);
  const originalPath = process.env.PATH, originalData = process.env.COUCH_DATA_DIR, certificates = process.env.SSL_CERT_FILE;
  const timers: ReturnType<typeof setInterval>[] = [], set = globalThis.setInterval;
  t.mock.method(globalThis, "setInterval", (...args: Parameters<typeof setInterval>) => { const timer = set(...args); timers.push(timer); return timer; });
  t.after(() => {
    for (const timer of timers) clearInterval(timer);
    for (const [key, value] of Object.entries({ PATH: originalPath, COUCH_DATA_DIR: originalData, SSL_CERT_FILE: certificates })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  });
  for (const [name, version] of [["yt-dlp", "2026.08.19"], ["qjs", "0.17.0"], ["ffmpeg", "ffmpeg version 7.0"]]) {
    writeFileSync(join(bin, name!), `#!${process.execPath}\nconst args = process.argv.slice(2); console.log(args.includes("--dump-single-json") ? JSON.stringify(args) : ${JSON.stringify(version)});\n`, { mode: 0o755 });
  }
  process.env.PATH = bin;
  process.env.COUCH_DATA_DIR = directory;
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Offline"); });
  startHelpers(join(directory, "helpers"));
  for (const target of ["scsearch25:artist", "https://soundcloud.com/artist/track"]) {
    const args = JSON.parse(await runYtDlp(["--dump-single-json", "--", target])) as string[];
    assert.equal(args[args.indexOf("--cache-dir") + 1], join(directory, "yt-dlp-cache"));
    assert.ok(args.includes("--no-plugin-dirs"), "User plugins must remain disabled");
    assert.ok(args.includes("--plugin-dirs"), "SoundCloud must use the bundled thumbnail override");
    const plugin = args[args.indexOf("--plugin-dirs") + 1]!;
    assert.throws(() => readFileSync(join(plugin, "bundled", "yt_dlp_plugins", "extractor", "soundcloud.py")), /ENOENT/, "The temporary plugin must be removed after extraction");
  }
  const other = JSON.parse(await runYtDlp(["--dump-single-json", "--", "https://example.com/track"])) as string[];
  assert.ok(other.includes("--no-cache-dir"));
  assert.ok(!other.includes("--plugin-dirs"));
  const rai = JSON.parse(await runYtDlp(["--dump-single-json", "--", "https://www.raiplay.it/video/example.html"])) as string[];
  assert.ok(rai.includes("--no-plugin-dirs"));
  assert.ok(rai.includes("--plugin-dirs"), "RaiPlay must retain the declared timed-preview track");
  assert.ok(rai.includes("--no-cache-dir"));
  const raiPlugin = rai[rai.indexOf("--plugin-dirs") + 1]!;
  assert.throws(() => readFileSync(join(raiPlugin, "bundled", "yt_dlp_plugins", "extractor", "raiplay.py")), /ENOENT/, "The RaiPlay override must be removed after extraction");
});

// Supply Couch's helper to exercise the real upstream extractor, with all network calls stubbed in Python.
test("SoundCloud extracts artwork and playable formats without per-track thumbnail probes", { skip: !process.env.COUCH_TEST_YT_DLP }, async () => {
  const plugin = await soundCloudPlugin();
  try {
    writeFileSync(join(plugin.directory, "bundled", "yt_dlp_plugins", "extractor", "offline.py"), fixture);
    const { stdout } = await promisify(execFile)(process.env.COUCH_TEST_YT_DLP!, ["--ignore-config", "--no-cache-dir", "--no-plugin-dirs", "--plugin-dirs", plugin.directory,
      "--use-extractors", "CouchSoundcloudTest,end", "--skip-download", "--dump-single-json", "--", "couchsoundcloud:test"], { timeout: 10_000 });
    assert.equal(JSON.parse(stdout).title, "SoundCloud offline checks passed");
  } finally { await plugin.close(); }
});
