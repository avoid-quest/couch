import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { strToU8, zipSync } from "fflate";
import { createHelperUpdates } from "../src/server/helper-updates";
import { readHelperStatus, writeJson } from "../src/server/helper-status";
import { checkHelper, helper, startHelpers, useHelper, type Helper } from "../src/server/helpers";

// Real executable probes and checksum-verified fixture downloads in a private PATH
// and helper directory. Only release servers are mocked; no installed data is used.
const options = { skip: process.platform !== "linux", timeout: 10_000 };
const program = (version: string) => `#!/bin/sh\nprintf '%s\\n' '${version}'\n`;

function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), "couch-helper-updates-"));
  const bin = join(directory, "bin"), helpers = join(directory, "helpers");
  const original = { PATH: process.env.PATH, COUCH_DATA_DIR: process.env.COUCH_DATA_DIR, SSL_CERT_FILE: process.env.SSL_CERT_FILE, COUCH_QJS_PATH: process.env.COUCH_QJS_PATH };
  const timers: ReturnType<typeof setInterval>[] = [], interval = globalThis.setInterval;
  t.mock.method(globalThis, "setInterval", (...args: Parameters<typeof setInterval>) => {
    const timer = interval(...args); timers.push(timer); return timer;
  });
  const updates = createHelperUpdates(helpers);
  t.after(async () => {
    await updates.close();
    for (const timer of timers) clearInterval(timer);
    for (const [name, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  });
  mkdirSync(bin);
  process.env.PATH = bin;
  process.env.COUCH_DATA_DIR = directory;
  t.mock.method(console, "error", () => {});

  const executable = (path: string, version: string) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, program(version), { mode: 0o755 });
    return path;
  };
  const system = (name: Helper, version: string) => executable(join(bin, name), version);
  const cached = (name: Helper, version: string, output = version) => executable(join(helpers, name, version, name), output);
  system("yt-dlp", "2026.08.01");
  system("qjs", "0.12.0");
  system("ffmpeg", "ffmpeg version 7.0");

  const releases = new Map<Helper, { version: string; data: Uint8Array; sha256: string }>();
  const state = { requests: [] as string[], offline: false, downloadError: false };
  const release = (name: Helper, version: string, failure?: "checksum" | "run") => {
    const output = name === "ffmpeg" ? `ffmpeg version ${version}` : version.replace(/^v/, "");
    const binary = strToU8(failure === "run" ? "#!/bin/sh\nexit 1\n" : program(output));
    const data = name === "qjs" ? binary : zipSync({ [name]: binary });
    releases.set(name, { version, data, sha256: failure === "checksum" ? "0".repeat(64) : createHash("sha256").update(data).digest("hex") });
  };
  release("yt-dlp", "2026.08.01");
  t.mock.method(globalThis, "fetch", async (url: string) => {
    state.requests.push(url);
    if (state.offline) throw new Error("Network unavailable");
    const name: Helper = url.includes("ffmpeg") ? "ffmpeg" : url.includes("quickjs") ? "qjs" : "yt-dlp";
    const build = releases.get(name);
    assert.ok(build, `Unexpected release request: ${url}`);
    if (url.endsWith(".sha256")) return new Response(build.sha256);
    if (url.includes("/redirect/latest/")) {
      const response = new Response(null, { status: 302, headers: { location: `https://ffmpeg.martin-riedl.de/build_${build.version}/ffmpeg.zip` } });
      Object.defineProperty(response, "url", { value: url });
      return response;
    }
    if (url.endsWith("/releases/latest")) return Response.json({
      tag_name: build.version,
      assets: (name === "qjs" ? ["qjs-linux-x86_64", "qjs-linux-aarch64"] : ["yt-dlp_linux.zip", "yt-dlp_linux_aarch64.zip"]).map(asset => ({
        name: asset, browser_download_url: `https://github.com/${name === "qjs" ? "quickjs-ng/quickjs" : "yt-dlp/yt-dlp"}/releases/download/${build.version}/${asset}`,
        digest: `sha256:${build.sha256}`,
      })),
    });
    if (state.downloadError) return new Response(null, { status: 503 });
    return new Response(build.data);
  });
  const start = async () => {
    startHelpers(helpers);
    await Promise.all((["yt-dlp", "qjs", "ffmpeg"] as const).map(name => helper(name)));
    state.requests = [];
  };
  const check = async () => { await updates.check(); await updates.close(); return (await updates.read()).items; };
  return { directory, bin, helpers, updates, system, cached, release, state, start, check };
}

test("bundled QuickJS works on first use and manual checks never replace it with a newer download", options, async t => {
  const f = fixture(t);
  rmSync(join(f.bin, "qjs"));
  const bundled = join(f.directory, "bundled-qjs");
  writeFileSync(bundled, program("0.17.0"), { mode: 0o755 });
  process.env.COUCH_QJS_PATH = bundled;
  f.cached("qjs", "v0.99.0", "0.99.0");
  f.release("qjs", "v0.99.1");
  await f.start();
  assert.equal(await helper("qjs"), bundled, "the app bundle takes precedence over the old download cache");
  assert.equal((await readHelperStatus(f.helpers)).selected.qjs?.origin, "bundled");
  rmSync(join(f.helpers, "qjs"), { recursive: true, force: true });
  assert.equal(await checkHelper("qjs"), bundled, "clearing the download cache leaves the bundled runtime usable");
  assert.deepEqual((await f.check()).find(item => item.name === "qjs"), { name: "qjs", version: "0.17.0", origin: "bundled", status: "compatible", error: null });
  assert.ok(f.state.requests.every(url => !url.includes("quickjs")), "the bundle is updated with Couch, never from the incompatible upstream binary feed");
});

test("a missing bundled QuickJS reports a repair instead of silently downloading an incompatible runtime", options, async t => {
  const f = fixture(t);
  await f.start();
  rmSync(join(f.bin, "qjs"));
  process.env.COUCH_QJS_PATH = join(f.directory, "missing-qjs");
  f.release("qjs", "v0.99.1");
  const item = (await f.check()).find(item => item.name === "qjs");
  assert.equal(item?.status, "error");
  assert.match(item?.error ?? "", /Reinstall Couch/);
  assert.ok(f.state.requests.every(url => !url.includes("quickjs")));
});

test("reads are passive, and checks without Core helper setup cannot write to an implicit directory", options, async t => {
  const f = fixture(t);
  assert.deepEqual(await f.updates.read(), { status: "idle", checkedAt: null, items: [] });
  assert.equal(existsSync(f.helpers), false);
  assert.equal((await f.updates.check()).status, "checking");
  await f.updates.close();
  const result = await f.updates.read();
  assert.equal(result.status, "done");
  assert.ok(result.checkedAt);
  assert.equal(result.items.length, 3);
  for (const item of result.items) {
    assert.equal(item.status, "error");
    assert.match(item.error!, /have not been started/);
    assert.equal(item.version, null);
  }
  assert.deepEqual(f.state.requests, []);
  assert.equal(existsSync(f.helpers), false);
});

test("manual checks honor an operator hold without checking or downloading yt-dlp", options, async t => {
  const f = fixture(t);
  f.cached("yt-dlp", "2026.07.01");
  await f.start();
  const hold = { schema: 1, helper: "yt-dlp", version: "2026.07.01", since: new Date().toISOString(), until: new Date(Date.now() + 86_400_000).toISOString() };
  await writeJson(join(f.helpers, "hold.json"), hold);
  f.release("yt-dlp", "2026.09.01");
  const [item] = await f.check();
  assert.deepEqual(item, { name: "yt-dlp", version: "2026.07.01", origin: "managed", status: "held", error: null });
  assert.deepEqual(JSON.parse(readFileSync(join(f.helpers, "hold.json"), "utf8")), hold);
  assert.deepEqual(f.state.requests, []);
});

test("only manual checks refresh compatible managed QuickJS and FFmpeg, retaining copies in use", options, async t => {
  const f = fixture(t);
  rmSync(join(f.bin, "qjs"));
  rmSync(join(f.bin, "ffmpeg"));
  const older = f.cached("qjs", "v0.12.0", "0.12.0");
  f.cached("ffmpeg", "7.0", "ffmpeg version 7.0");
  f.release("qjs", "v0.13.0");
  f.release("ffmpeg", "8.0");
  await f.start();
  await checkHelper("qjs");
  await checkHelper("ffmpeg");
  assert.deepEqual(f.state.requests, [], "startup and daily selection only check compatibility");
  const using = await useHelper("qjs");
  t.after(using.release);
  const items = await f.check();
  assert.deepEqual(items.slice(1).map(item => [item.version, item.status, item.origin]), [["v0.13.0", "updated", "managed"], ["8.0", "updated", "managed"]]);
  assert.ok(existsSync(older), "an update keeps the executable a running extraction uses");
  assert.ok((await readHelperStatus(f.helpers)).selected.qjs?.sha256);
  using.release();
  assert.deepEqual((await f.check()).slice(1).map(item => item.status), ["current", "current"]);
  assert.equal(existsSync(older), false, "a later check prunes the released copy");
});

for (const failure of ["download", "checksum", "run"] as const) test(`a ${failure} failure retains a working helper and reports the error`, options, async t => {
  const f = fixture(t);
  await f.start();
  f.release("yt-dlp", "2026.09.01", failure === "download" ? undefined : failure);
  f.state.downloadError = failure === "download";
  const [item] = await f.check();
  assert.equal(item?.status, "error");
  assert.equal(item?.version, "2026.08.01");
  assert.equal(item?.origin, "system");
  assert.match(item?.error ?? "", failure === "download" ? /503/ : failure === "checksum" ? /SHA-256/ : /doesn't run/);
  assert.equal(await helper("yt-dlp"), join(f.bin, "yt-dlp"));
  assert.equal(existsSync(join(f.helpers, "yt-dlp", "2026.09.01", "yt-dlp")), false);
  const passive = createHelperUpdates(f.helpers);
  const before = readFileSync(join(f.helpers, "status.json"), "utf8"), requests = f.state.requests.length;
  assert.equal((await passive.read()).items.find(item => item.name === "yt-dlp")?.status, "error", "passive status does not call an older fallback current");
  assert.equal(readFileSync(join(f.helpers, "status.json"), "utf8"), before);
  assert.equal(f.state.requests.length, requests);
});

test("offline release checks keep the newer managed copy but do not report it current", options, async t => {
  const f = fixture(t);
  f.cached("yt-dlp", "2026.09.01");
  f.release("yt-dlp", "2026.09.01");
  await f.start();
  f.state.offline = true;
  const [item] = await f.check();
  assert.deepEqual(item, { name: "yt-dlp", version: "2026.09.01", origin: "managed", status: "error", error: "Network unavailable" });
  assert.equal(await helper("yt-dlp"), join(f.helpers, "yt-dlp", "2026.09.01", "yt-dlp"));
});

test("newer managed copies are not downgraded to the offered release", options, async t => {
  const f = fixture(t);
  rmSync(join(f.bin, "qjs"));
  f.cached("qjs", "v0.14.0", "0.14.0");
  f.release("qjs", "v0.13.0");
  await f.start();
  const items = await f.check();
  assert.deepEqual(items.find(item => item.name === "qjs"), { name: "qjs", version: "v0.14.0", origin: "managed", status: "current", error: null });
  assert.equal(f.state.requests.some(url => url.includes("/download/")), false);
});

test("installed Linux mpv stays system-managed, while an old one reports a required package update", options, async t => {
  const f = fixture(t);
  const mpv = f.system("mpv", "mpv 0.40.0");
  await f.start();
  assert.deepEqual((await f.check()).find(item => item.name === "mpv"), { name: "mpv", version: "mpv 0.40.0", origin: "system", status: "system", error: null });
  f.system("mpv", "mpv 0.34.0");
  const item = (await f.check()).find(item => item.name === "mpv");
  assert.equal(item?.status, "error");
  assert.match(item?.error ?? "", /Install the mpv package/);
  assert.equal(readFileSync(mpv, "utf8"), program("mpv 0.34.0"));
  assert.equal(existsSync(join(f.helpers, "mpv")), false);
  assert.ok(f.state.requests.every(url => url.includes("yt-dlp")));
});
