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
import { runYtDlp } from "../src/server/yt-dlp";

// Real executable probes and checksum-verified fixture downloads in a private PATH
// and helper directory. Only release servers are mocked; no installed data is used.
const options = { skip: process.platform !== "linux", timeout: 10_000 };
const program = (version: string) => `#!/bin/sh\nprintf '%s\\n' '${version}'\n`;

function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), "couch-helper-updates-"));
  const bin = join(directory, "bin"), helpers = join(directory, "helpers");
  const original = { PATH: process.env.PATH, COUCH_DATA_DIR: process.env.COUCH_DATA_DIR, SSL_CERT_FILE: process.env.SSL_CERT_FILE };
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
  const state = { requests: [] as string[], pause: null as Promise<void> | null, offline: false, downloadError: false };
  const release = (name: Helper, version: string, failure?: "checksum" | "run") => {
    const output = name === "ffmpeg" ? `ffmpeg version ${version}` : version.replace(/^v/, "");
    const binary = strToU8(failure === "run" ? "#!/bin/sh\nexit 1\n" : program(output));
    const data = name === "qjs" ? binary : zipSync({ [name]: binary });
    releases.set(name, { version, data, sha256: failure === "checksum" ? "0".repeat(64) : createHash("sha256").update(data).digest("hex") });
  };
  release("yt-dlp", "2026.08.01");
  t.mock.method(globalThis, "fetch", async (url: string) => {
    state.requests.push(url);
    if (url.endsWith("/releases/latest")) await state.pause;
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

test("manual checks return immediately, coalesce overlaps, and serialize with daily checks", options, async t => {
  const f = fixture(t);
  await f.start();
  f.release("yt-dlp", "2026.09.01");
  let resume = () => {};
  f.state.pause = new Promise<void>(resolve => { resume = resolve; });
  t.after(resume);
  assert.equal((await f.updates.check()).status, "checking");
  assert.equal((await f.updates.check()).status, "checking");
  const deadline = Date.now() + 2_000;
  while (!f.state.requests.length && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(f.state.requests.length, 1);
  const daily = checkHelper("yt-dlp");
  while ((await f.updates.read()).items.filter(item => item.status === "compatible").length < 2 && Date.now() < deadline)
    await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal((await f.updates.read()).items.filter(item => item.status === "compatible").length, 2, "independent tools finish while yt-dlp is waiting");
  assert.equal(f.state.requests.length, 1, "the daily check waits for the manual one");
  resume();
  await f.updates.close();
  await daily;
  const result = await f.updates.read();
  assert.equal(result.status, "done");
  assert.deepEqual(result.items.map(item => [item.name, item.status, item.origin]), [
    ["yt-dlp", "updated", "managed"], ["qjs", "compatible", "system"], ["ffmpeg", "compatible", "system"],
  ]);
  assert.equal(f.state.requests.filter(url => url.endsWith("/releases/latest")).length, 2);
  assert.ok(f.state.requests.every(url => url.includes("yt-dlp")), "compatible system tools need no release or package-manager requests");
  assert.equal(existsSync(join(f.helpers, "mpv")), false);
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

test("updating QuickJS keeps the copy an active extractor will launch later", options, async t => {
  const f = fixture(t);
  rmSync(join(f.bin, "qjs"));
  const older = f.cached("qjs", "v0.12.0", "0.12.0");
  f.release("qjs", "v0.13.0");
  const started = join(f.directory, "extracting"), resume = join(f.directory, "resume");
  writeFileSync(join(f.bin, "yt-dlp"), `#!/bin/sh
if [ "$1" = "--version" ]; then printf '2026.08.01\\n'; exit; fi
for arg in "$@"; do case "$arg" in quickjs:*) runtime="\${arg#quickjs:}";; esac; done
: > '${started}'
while [ ! -e '${resume}' ]; do /bin/sleep 0.01; done
exec "$runtime" --version
`, { mode: 0o755 });
  await f.start();
  const cancellation = new AbortController();
  const extraction = runYtDlp(["--", "https://www.youtube.com/watch?v=fixture"], { signal: cancellation.signal });
  void extraction.catch(() => {});
  try {
    const deadline = Date.now() + 2_000;
    while (!existsSync(started) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    assert.ok(existsSync(started), "the extractor has received its QuickJS path");
    assert.equal((await f.check()).find(item => item.name === "qjs")?.status, "updated");
    assert.ok(existsSync(older), "the deferred subprocess still needs the old copy");
    writeFileSync(resume, "");
    assert.equal((await extraction).trim(), "0.12.0");
    await f.check();
    assert.equal(existsSync(older), false, "finished extractions release their copy");
  } finally {
    cancellation.abort();
    await extraction.catch(() => {});
  }
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

test("a failed managed upgrade keeps its older copy and does not stop the next helper's update", options, async t => {
  const f = fixture(t);
  rmSync(join(f.bin, "qjs"));
  rmSync(join(f.bin, "ffmpeg"));
  const qjs = f.cached("qjs", "v0.12.0", "0.12.0");
  f.cached("ffmpeg", "7.0", "ffmpeg version 7.0");
  f.release("qjs", "v0.13.0", "checksum");
  f.release("ffmpeg", "8.0");
  await f.start();
  const items = await f.check();
  assert.deepEqual(items.slice(1).map(item => [item.version, item.status]), [["v0.12.0", "error"], ["8.0", "updated"]]);
  assert.match(items[1]?.error ?? "", /SHA-256/);
  assert.equal(await helper("qjs"), qjs);
});

test("a repair cannot replace the same managed version while a run still uses it", options, async t => {
  const f = fixture(t);
  rmSync(join(f.bin, "qjs"));
  const qjs = f.cached("qjs", "v0.12.0", "0.12.0");
  f.release("qjs", "v0.12.0");
  await f.start();
  const using = await useHelper("qjs");
  t.after(using.release);
  // The file stops passing its probe while an existing run retains that directory.
  writeFileSync(qjs, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  const item = (await f.check()).find(item => item.name === "qjs");
  assert.equal(item?.status, "error");
  assert.match(item?.error ?? "", /still in use/);
  assert.equal(readFileSync(qjs, "utf8"), "#!/bin/sh\nexit 1\n");
  using.release();
  assert.equal((await f.check()).find(item => item.name === "qjs")?.error, null);
  assert.equal(await helper("qjs"), qjs);
  assert.equal(readFileSync(qjs, "utf8"), program("0.12.0"));
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
