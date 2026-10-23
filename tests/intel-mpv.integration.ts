import { after, test } from "node:test";
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { strToU8, zipSync } from "fflate";

// Simulate Intel macOS selection on Linux. Helper probes execute real shell
// fixtures; only sw_vers and release servers are mocked. This is not Mac execution.
const linux = process.platform === "linux";
const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
const arch = Object.getOwnPropertyDescriptor(process, "arch")!;
if (linux) {
  Object.defineProperty(process, "platform", { value: "darwin" });
  Object.defineProperty(process, "arch", { value: "x64" });
}
after(() => {
  Object.defineProperty(process, "platform", platform);
  Object.defineProperty(process, "arch", arch);
});
const { helper, startHelpers, updateHelper } = await import("../src/server/helpers");
const { readHelperStatus } = await import("../src/server/helper-status");
const program = (version: string) => `#!/bin/sh\nprintf '%s\\n' '${version}'\n`;

const scenarios: Array<{ name: string; os: string; system?: string; cached?: string; brokenCache?: boolean; expected: "blocked" | "system" | "cached" | "download" }> = [
  { name: "Ventura without mpv explains the optional channel limit", os: "13.7.8", expected: "blocked" },
  { name: "Sonoma without mpv avoids the incompatible download", os: "14.7.8", expected: "blocked" },
  { name: "a compatible PATH copy takes precedence over the cache", os: "13.7.8", system: "mpv 0.40.0", cached: "mpv 0.41.0", expected: "system" },
  { name: "an old PATH copy permits a compatible cached fallback", os: "13.7.8", system: "mpv 0.34.0", cached: "mpv 0.40.0", expected: "cached" },
  { name: "a broken PATH copy permits a compatible cached fallback", os: "13.7.8", system: "broken", cached: "mpv 0.40.0", expected: "cached" },
  { name: "Sonoma retains its compatible cache during manual updates", os: "14.7.8", cached: "mpv 0.40.0", expected: "cached" },
  { name: "a broken cache is rejected without an incompatible download", os: "13.7.8", cached: "mpv 0.40.0", brokenCache: true, expected: "blocked" },
  { name: "an obsolete cache does not enable unsupported mpv commands", os: "13.7.8", cached: "mpv 0.34.0", expected: "blocked" },
  { name: "an unreadable OS version cannot authorize the download", os: "", expected: "blocked" },
  { name: "macOS 15 automatically installs verified Intel mpv", os: "15.0", expected: "download" },
  { name: "newer macOS automatically replaces an obsolete PATH mpv", os: "26.1", system: "mpv 0.34.0", expected: "download" },
];

for (const scenario of scenarios) test(scenario.name, { skip: !linux, timeout: 10_000 }, async t => {
  const directory = mkdtempSync(join(tmpdir(), "couch-intel-mpv-"));
  const bin = join(directory, "bin"), helpers = join(directory, "helpers");
  const original = { PATH: process.env.PATH, SSL_CERT_FILE: process.env.SSL_CERT_FILE };
  const timers: ReturnType<typeof setInterval>[] = [], interval = globalThis.setInterval;
  t.mock.method(globalThis, "setInterval", (...args: Parameters<typeof setInterval>) => {
    const timer = interval(...args); timers.push(timer); return timer;
  });
  t.after(() => {
    timers.forEach(clearInterval);
    t.mock.restoreAll();
    syncBuiltinESMExports();
    for (const [name, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  });
  const executable = (path: string, version: string, broken = false) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, broken ? "#!/bin/sh\nexit 1\n" : program(version), { mode: 0o755 });
  };
  executable(join(bin, "yt-dlp"), "2026.10.21");
  executable(join(bin, "qjs"), "0.17.0");
  executable(join(bin, "ffmpeg"), "ffmpeg version 9.0.2");
  if (scenario.system) executable(join(bin, "mpv"), scenario.system, scenario.system === "broken");
  const cached = join(helpers, "mpv", "v0.40.0", "mpv.app/Contents/MacOS/mpv");
  if (scenario.cached) executable(cached, scenario.cached, scenario.brokenCache);
  process.env.PATH = bin;
  const exec = childProcess.execFile;
  t.mock.method(childProcess, "execFile", (path, args, options, callback) => {
    if (path !== "/usr/bin/sw_vers") return exec(path, args, options, callback);
    assert.deepEqual(args, ["-productVersion"]);
    queueMicrotask(() => callback(scenario.os ? null : new Error("sw_vers unavailable"), scenario.os, ""));
    return {} as childProcess.ChildProcess;
  });
  syncBuiltinESMExports();
  t.mock.method(console, "error", () => {});
  const requests: string[] = [];
  const asset = "mpv-v0.41.0-macos-15-intel.zip";
  const url = `https://github.com/mpv-player/mpv/releases/download/v0.41.0/${asset}`;
  const data = zipSync({ "mpv.app/Contents/MacOS/mpv": strToU8(program("mpv 0.41.0")) });
  t.mock.method(globalThis, "fetch", async (input: string) => {
    requests.push(input);
    if (input.includes("yt-dlp")) return Response.json({ tag_name: "2026.10.21", assets: [{ name: "yt-dlp_macos.zip", browser_download_url: "https://example.com/yt-dlp.zip", digest: `sha256:${"0".repeat(64)}` }] });
    if (input === "https://api.github.com/repos/mpv-player/mpv/releases/latest") return Response.json({ tag_name: "v0.41.0", assets: [{ name: asset, browser_download_url: url, digest: `sha256:${createHash("sha256").update(data).digest("hex")}` }] });
    assert.equal(input, url);
    return new Response(data);
  });

  startHelpers(helpers);
  await Promise.all([helper("yt-dlp"), helper("qjs"), helper("ffmpeg")]);
  assert.equal((await readHelperStatus(helpers)).selected.mpv, undefined, "startup does not require the optional native player");
  assert.ok(requests.every(url => url.includes("yt-dlp")));
  requests.length = 0;
  if (scenario.expected === "blocked") {
    await assert.rejects(helper("mpv"), /This channel needs mpv.*Automatic Intel mpv downloads require macOS 15.*Install a compatible mpv 0\.35/);
    assert.deepEqual(requests, []);
    if (scenario.brokenCache) assert.equal(existsSync(cached), false);
    assert.equal(await helper("qjs"), join(bin, "qjs"), "ordinary media helpers remain available");
  } else {
    const expected = scenario.expected === "system" ? join(bin, "mpv") : scenario.expected === "cached" ? cached : join(helpers, "mpv", "v0.41.0", "mpv.app/Contents/MacOS/mpv");
    assert.equal(await helper("mpv"), expected);
    assert.equal((await updateHelper(helpers, "mpv")).error, null, "manual checks keep a compatible local copy usable");
    if (scenario.expected === "download") {
      assert.ok(requests.includes(url));
      assert.equal(readFileSync(expected, "utf8"), program("mpv 0.41.0"));
    } else assert.deepEqual(requests, []);
  }
});
