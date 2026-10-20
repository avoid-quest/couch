import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import fsp from "node:fs/promises";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Readable } from "node:stream";
import { strToU8, zipSync } from "fflate";
import { checkHelper, helper, helpersCommand, startHelpers } from "../src/server/helpers";
import { readHelperStatus, updateStatus } from "../src/server/helper-status";
import { ExtractionError, runYtDlp } from "../src/server/yt-dlp";
import { inspectWebMedia, resolveWebMedia } from "../src/server/web-media";

// Core's helper selection and yt-dlp runs with real fixture executables in a private PATH and
// data directory. Only GitHub (release lookups and downloads) is replaced; downloads are real
// zips checked against their SHA-256. No installed Couch or its data is touched.
const video = "https://www.youtube.com/watch?v=couch";

// A stand-in yt-dlp: prints its version, or "extracts" by reading a file from its own copy,
// so a copy removed mid-run fails. A copy that works returns playable media titled with that
// file; an "unusable" one exits cleanly with media information Couch can't play. It waits
// while `<dir>/block` exists, and logs each run.
// One --version of the copy named in `<dir>/probe-gate` waits while `probe-gate-held` exists,
// then fails if the name ends in "!".
function program(directory: string, version: string, works: boolean | "unusable") {
  return `#!${process.execPath}
const fs = process.getBuiltinModule("node:fs"), path = process.getBuiltinModule("node:path");
const version = ${JSON.stringify(version)}, here = path.dirname(fs.realpathSync(process.argv[1]));
if (process.argv[2] === "--version") {
  const gate = ${JSON.stringify(join(directory, "probe-gate"))}, held = gate + "-held";
  let gated = false, fails = false;
  try {
    const name = fs.readFileSync(gate, "utf8");
    fails = name.endsWith("!");
    gated = name.replace(/!$/, "") === version && (fs.renameSync(gate, held), true);
  } catch {}
  const answer = () => gated && fs.existsSync(held) ? setTimeout(answer, 20) : gated && fails ? process.exit(1) : console.log(version);
  answer();
} else {
  fs.appendFileSync(${JSON.stringify(join(directory, "runs"))}, version + "\\n");
  const finish = () => {
    const data = fs.readFileSync(path.join(here, "_internal", "extractor"), "utf8");
    if (!${JSON.stringify(works)}) { console.error("ERROR: [youtube] couch: HTTP Error 403: Forbidden"); process.exit(1); }
    console.log(JSON.stringify(${JSON.stringify(works)} === true ? { url: "https://media.example/" + version + ".mp4", title: data } : { title: data }));
  };
  const wait = () => fs.existsSync(${JSON.stringify(join(directory, "block"))}) ? setTimeout(wait, 20) : finish();
  wait();
}
`;
}

function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), "couch-helper-recovery-"));
  const bin = join(directory, "bin"), helpers = join(directory, "helpers");
  const originalPath = process.env.PATH, originalCertificates = process.env.SSL_CERT_FILE, originalData = process.env.COUCH_DATA_DIR;
  const timers: ReturnType<typeof setInterval>[] = [], set = globalThis.setInterval;
  t.mock.method(globalThis, "setInterval", (...args: Parameters<typeof setInterval>) => { const timer = set(...args); timers.push(timer); return timer; });
  t.after(async () => {
    for (const timer of timers) clearInterval(timer);
    // Status writes are serialized; this one lands after any a run left pending.
    await updateStatus(helpers, () => {});
    for (const [key, value] of Object.entries({ PATH: originalPath, SSL_CERT_FILE: originalCertificates, COUCH_DATA_DIR: originalData })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  });
  mkdirSync(bin);
  writeFileSync(join(bin, "qjs"), "#!/bin/sh\necho 0.17.0\n", { mode: 0o755 });
  writeFileSync(join(bin, "ffmpeg"), "#!/bin/sh\necho 'ffmpeg version 7.0'\n", { mode: 0o755 });
  process.env.PATH = bin;
  process.env.COUCH_DATA_DIR = directory;

  // GitHub's latest yt-dlp release, served as a real zip with its recorded SHA-256; null is offline.
  const releases = new Map<string, Uint8Array>();
  // `pause` holds a release lookup until it settles; the answer is the release at that point.
  const state = { latest: null as string | null, requests: [] as string[], pause: null as Promise<void> | null };
  const release = (version: string, works: boolean | "unusable") => {
    releases.set(version, zipSync({ "yt-dlp_linux": strToU8(program(directory, version, works)), "_internal/extractor": strToU8(`extractor ${version}`) }));
    state.latest = version;
    return createHash("sha256").update(releases.get(version)!).digest("hex");
  };
  t.mock.method(globalThis, "fetch", async (url: string) => {
    state.requests.push(url);
    const download = /\/download\/([^/]+)\//.exec(url)?.[1];
    if (!download) await state.pause;
    if (!state.latest) throw new Error("Network unavailable");
    if (download) return new Response(releases.get(download));
    return Response.json({ tag_name: state.latest, assets: ["yt-dlp_macos.zip", "yt-dlp_linux.zip", "yt-dlp_linux_aarch64.zip"].map(name => ({
      name, browser_download_url: `https://github.com/yt-dlp/yt-dlp/releases/download/${state.latest}/${name}`,
      digest: `sha256:${createHash("sha256").update(releases.get(state.latest!)!).digest("hex")}`,
    })) });
  });
  t.mock.method(console, "error", () => {});

  // A copy already in Couch's cache, as an earlier Couch left it.
  const cached = (version: string, works: boolean | "unusable") => {
    mkdirSync(join(helpers, "yt-dlp", version, "_internal"), { recursive: true });
    writeFileSync(join(helpers, "yt-dlp", version, "yt-dlp_linux"), program(directory, version, works), { mode: 0o755 });
    writeFileSync(join(helpers, "yt-dlp", version, "_internal", "extractor"), `extractor ${version}`);
  };
  const path = (version: string) => join(helpers, "yt-dlp", version, "yt-dlp_linux");
  const copies = () => readdirSync(join(helpers, "yt-dlp")).sort();
  const runs = () => existsSync(join(directory, "runs")) ? readFileSync(join(directory, "runs"), "utf8").trim().split("\n") : [];
  const status = () => readHelperStatus(helpers);
  const block = (on: boolean) => on ? writeFileSync(join(directory, "block"), "") : rmSync(join(directory, "block"), { force: true });
  // Playback resolution, the run that records whether a copy worked; its media's title names the copy's file.
  const play = async (url = video) => (await resolveWebMedia(url)).metadata?.title;
  return { directory, helpers, state, release, cached, path, copies, runs, status, block, play };
}

async function until(condition: () => boolean | Promise<boolean>, message: string) {
  const deadline = Date.now() + 5_000;
  while (!await condition()) {
    if (Date.now() > deadline) assert.fail(message);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

const options = { skip: process.platform === "win32", timeout: 20_000 };

test("a runnable update that fails extraction stays selected until the operator chooses the copy that worked", options, async t => {
  const f = fixture(t);
  f.release("2026.08.01", true);
  startHelpers(f.helpers);
  assert.match(await f.play(), /extractor 2026\.08\.01/);
  await until(async () => !!(await f.status()).managed["yt-dlp"]?.["2026.08.01"]?.worked.youtube, "a successful extraction is recorded for the copy that ran it");

  // The daily check installs a newer release that runs (--version) but breaks extraction.
  const digest = f.release("2026.09.01", false);
  assert.equal(await checkHelper("yt-dlp"), f.path("2026.09.01"));
  await assert.rejects(f.play(), ExtractionError);
  await assert.rejects(f.play(), ExtractionError);
  assert.equal(await helper("yt-dlp"), f.path("2026.09.01"), "a website's 403 never downgrades yt-dlp by itself");
  let status = await f.status();
  assert.deepEqual(status.selected["yt-dlp"], { ...status.selected["yt-dlp"], origin: "managed", version: "2026.09.01", path: f.path("2026.09.01"), sha256: digest, latest: "2026.09.01", held: false });
  assert.ok(Date.parse(status.selected["yt-dlp"]!.verifiedAt) > 0);
  assert.deepEqual(status.managed["yt-dlp"]?.["2026.09.01"]?.worked, {}, "running is not the same as having worked");
  assert.deepEqual(f.copies(), ["2026.08.01", "2026.09.01"], "the copy that worked is kept as the previous one");

  const before = f.state.requests.length;
  const message = await helpersCommand(f.helpers, ["previous"]);
  assert.match(message, /2026\.08\.01, which worked before,/);
  assert.equal(f.state.requests.length, before, "choosing the previous copy downloads nothing");
  assert.match(await f.play(), /extractor 2026\.08\.01/, "the next run uses the held copy without a restart");
  assert.deepEqual(f.runs(), ["2026.08.01", "2026.09.01", "2026.09.01", "2026.08.01"]);
  status = await f.status();
  assert.equal(status.selected["yt-dlp"]?.held, true);
  assert.equal(status.selected["yt-dlp"]?.path, f.path("2026.08.01"));
  assert.equal(status.hold?.active, true);
  const days = (Date.parse(status.hold!.until) - Date.parse(status.hold!.since)) / 86_400_000;
  assert.equal(days, 7);
});

test("a hold survives restarts and daily checks, and ends with --helpers latest or when it expires", options, async t => {
  const f = fixture(t);
  f.cached("2026.08.01", true);
  f.release("2026.09.01", true);
  startHelpers(f.helpers);
  assert.equal(await helper("yt-dlp"), f.path("2026.09.01"));
  assert.match(await helpersCommand(f.helpers, ["previous", "2"]), /^Couch uses yt-dlp 2026\.08\.01 from its next run until /);

  // A restart and a newer release don't replace the operator's choice, nor check for one.
  f.release("2026.09.02", true);
  const before = f.state.requests.length;
  startHelpers(f.helpers);
  assert.equal(await helper("yt-dlp"), f.path("2026.08.01"));
  assert.equal(await checkHelper("yt-dlp"), f.path("2026.08.01"));
  assert.equal(f.state.requests.length, before);
  assert.deepEqual(f.copies(), ["2026.08.01", "2026.09.01"]);

  assert.match(await helpersCommand(f.helpers, ["latest"]), /^Couch returns to the latest yt-dlp from its next run\. A --helpers command run at the same time can replace this; --helpers status shows the current hold\.$/);
  assert.match(await f.play(), /extractor 2026\.09\.02/);
  assert.equal((await f.status()).hold, null);
  assert.deepEqual(f.copies(), ["2026.09.01", "2026.09.02"], "at most one previous copy is kept");

  await helpersCommand(f.helpers, ["previous"]);
  assert.equal(await helper("yt-dlp"), f.path("2026.09.01"));
  const hold = JSON.parse(readFileSync(join(f.helpers, "hold.json"), "utf8"));
  writeFileSync(join(f.helpers, "hold.json"), JSON.stringify({ ...hold, until: new Date(Date.now() - 1000).toISOString() }));
  assert.equal(await helper("yt-dlp"), f.path("2026.09.02"), "an expired hold returns to the latest");
  assert.equal((await f.status()).hold?.active, false);
  assert.equal((await f.status()).selected["yt-dlp"]?.held, false);

  await assert.rejects(helpersCommand(f.helpers, ["previous", "31"]), /Usage/);
  await assert.rejects(helpersCommand(f.helpers, ["previous", "0"]), /Usage/);
});

test("offline, the newest cached copy is selected, recorded as unchecked, and the passive status changes nothing", options, async t => {
  const f = fixture(t);
  f.cached("2026.08.01", true);
  f.cached("2026.09.01", true);
  startHelpers(f.helpers);
  assert.equal(await helper("yt-dlp"), f.path("2026.09.01"));
  await until(async () => Object.keys((await f.status()).selected).length === 3, "every helper's selection is recorded");
  const status = await f.status();
  assert.deepEqual(status.selected["yt-dlp"], { ...status.selected["yt-dlp"], origin: "managed", version: "2026.09.01", sha256: null, latest: null, held: false });
  assert.equal(status.selected.qjs?.origin, "system");
  assert.equal(status.selected.qjs?.version, "0.17.0");
  assert.equal(status.selected.ffmpeg?.path, join(f.directory, "bin", "ffmpeg"));
  assert.deepEqual(f.copies(), ["2026.08.01", "2026.09.01"]);

  // A newer release appearing doesn't change what the passive view reports as selected.
  f.release("2026.10.01", true);
  const requests = f.state.requests.length;
  assert.deepEqual(JSON.parse(await helpersCommand(f.helpers, ["status"])), status);
  assert.equal(f.state.requests.length, requests);
  assert.deepEqual(f.copies(), ["2026.08.01", "2026.09.01"]);
  assert.deepEqual(f.runs(), [], "the status view runs no helper");
});

test("an interrupted download or status write is discarded and repaired", options, async t => {
  const f = fixture(t);
  f.cached("2026.08.01", true);
  f.cached("2026.09.01.partial", true);
  mkdirSync(f.helpers, { recursive: true });
  writeFileSync(join(f.helpers, "status.json"), '{"schema":1,"selected":{"yt-d');
  writeFileSync(join(f.helpers, "status.json.4242.tmp"), "{");
  startHelpers(f.helpers);
  assert.equal(await helper("yt-dlp"), f.path("2026.08.01"));
  assert.deepEqual(f.copies(), ["2026.08.01"], "a copy that was never promoted is never used");
  await until(async () => (await f.status()).selected["yt-dlp"]?.version === "2026.08.01", "a truncated status is rewritten");

  const digest = f.release("2026.09.01", true);
  assert.equal(await checkHelper("yt-dlp"), f.path("2026.09.01"));
  assert.equal((await f.status()).selected["yt-dlp"]?.sha256, digest);
  assert.match(await f.play(), /extractor 2026\.09\.01/);
});

test("a missing or broken previous copy is never held, and a held copy that disappears returns to the latest", options, async t => {
  const f = fixture(t);
  f.cached("2026.08.01", true);
  f.release("2026.09.01", true);
  startHelpers(f.helpers);
  assert.equal(await helper("yt-dlp"), f.path("2026.09.01"));
  await until(async () => !!(await f.status()).selected["yt-dlp"], "the selection is recorded");
  await helpersCommand(f.helpers, ["previous"]);
  assert.equal(await helper("yt-dlp"), f.path("2026.08.01"));

  rmSync(join(f.helpers, "yt-dlp", "2026.08.01"), { recursive: true });
  assert.equal(await helper("yt-dlp"), f.path("2026.09.01"), "a missing held copy is repaired with the latest");
  assert.equal((await f.status()).selected["yt-dlp"]?.held, false);
  assert.equal((await f.status()).hold?.active, true, "the operator's hold is left for them to end");
  await assert.rejects(helpersCommand(f.helpers, ["previous"]), /no earlier yt-dlp than 2026\.09\.01/);
  assert.equal((await f.status()).hold?.version, "2026.08.01", "a failed command leaves the earlier hold as it was");

  // A copy that no longer runs isn't offered either.
  await helpersCommand(f.helpers, ["latest"]);
  f.cached("2026.08.01", true);
  writeFileSync(f.path("2026.08.01"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  await assert.rejects(helpersCommand(f.helpers, ["previous"]), /no earlier yt-dlp/);
  assert.equal(existsSync(join(f.helpers, "hold.json")), false);
});

test("an extraction still running on a replaced copy keeps it until it finishes", options, async t => {
  const f = fixture(t);
  f.release("2026.08.01", true);
  startHelpers(f.helpers);
  await f.play();
  await until(async () => !!(await f.status()).managed["yt-dlp"]?.["2026.08.01"]?.worked.youtube, "the first copy worked");
  f.release("2026.09.01", true);
  await checkHelper("yt-dlp");

  // 2026.09.01 has no evidence yet, so the next update keeps 2026.08.01 as the previous copy;
  // only the run in progress keeps 2026.09.01 on disk.
  f.block(true);
  const running = f.play();
  await until(() => f.runs().length === 2, "the extraction started on 2026.09.01");
  f.release("2026.10.01", true);
  assert.equal(await checkHelper("yt-dlp"), f.path("2026.10.01"));
  assert.deepEqual(f.copies(), ["2026.08.01", "2026.09.01", "2026.10.01"]);
  f.block(false);
  assert.match(await running, /extractor 2026\.09\.01/, "the older run reads its own files to the end");
  assert.match(await f.play("https://www.twitch.tv/couch"), /extractor 2026\.10\.01/);
  assert.deepEqual(f.runs(), ["2026.08.01", "2026.09.01", "2026.10.01"]);

  // The next check prunes again; 2026.09.01 has now worked, so it is the previous copy.
  await until(async () => !!(await f.status()).managed["yt-dlp"]?.["2026.09.01"]?.worked.youtube, "the finished run is recorded");
  await checkHelper("yt-dlp");
  assert.deepEqual(f.copies(), ["2026.09.01", "2026.10.01"]);
  assert.deepEqual(Object.keys((await f.status()).managed["yt-dlp"]!).sort(), ["2026.09.01", "2026.10.01"]);
});

test("a copy --helpers previous is checking while an update removes it is kept, so the command's success stands", options, async t => {
  const f = fixture(t);
  f.release("2026.08.01", true);
  startHelpers(f.helpers);
  assert.equal(await helper("yt-dlp"), f.path("2026.08.01"));
  f.release("2026.09.01", true);
  await checkHelper("yt-dlp");
  await f.play();
  await until(async () => !!(await f.status()).managed["yt-dlp"]?.["2026.09.01"]?.worked.youtube, "2026.09.01 worked, so an update would keep it and remove 2026.08.01");

  // The daily check has read no hold and waits for GitHub while `previous` checks 2026.08.01.
  let resume = () => {};
  f.state.pause = new Promise<void>(resolve => { resume = resolve; });
  const requests = f.state.requests.length;
  const daily = checkHelper("yt-dlp");
  await until(() => f.state.requests.length > requests, "the daily check is looking up the latest release");
  writeFileSync(join(f.directory, "probe-gate"), "2026.08.01");
  const recovering = helpersCommand(f.helpers, ["previous"]);
  await until(() => existsSync(join(f.directory, "probe-gate-held")), "the command is checking 2026.08.01");
  f.release("2026.10.01", true);
  f.state.pause = null;
  resume();
  assert.equal(await daily, f.path("2026.10.01"));
  assert.ok(f.copies().includes("2026.08.01"), "the update keeps the copy the operator is holding");
  rmSync(join(f.directory, "probe-gate-held"));
  assert.match(await recovering, /^Couch uses yt-dlp 2026\.08\.01 from its next run/);
  assert.match(await f.play(), /extractor 2026\.08\.01/);
  assert.equal((await f.status()).selected["yt-dlp"]?.held, true);
});

test("while PATH's yt-dlp is used, Couch keeps only its previous copy and one a run is using", options, async t => {
  const f = fixture(t);
  f.release("2026.08.01", true);
  startHelpers(f.helpers);
  await f.play();
  await until(async () => !!(await f.status()).managed["yt-dlp"]?.["2026.08.01"]?.worked.youtube, "2026.08.01 worked");
  f.release("2026.09.01", true);
  await checkHelper("yt-dlp");
  f.block(true);
  const running = f.play();
  await until(() => f.runs().length === 2, "the extraction started on 2026.09.01");

  f.release("2026.10.01", true);
  const system = join(f.directory, "bin", "yt-dlp");
  writeFileSync(system, program(f.directory, "2026.10.01", true), { mode: 0o755 });
  assert.equal(await checkHelper("yt-dlp"), system);
  assert.deepEqual(f.copies(), ["2026.08.01", "2026.09.01"], "the previous copy that worked, and the one in use");
  f.block(false);
  assert.match(await running, /extractor 2026\.09\.01/);
  await until(async () => !!(await f.status()).managed["yt-dlp"]?.["2026.09.01"]?.worked.youtube, "the finished run is recorded");
  assert.equal(await checkHelper("yt-dlp"), system);
  assert.deepEqual(f.copies(), ["2026.09.01"]);
  const status = await f.status();
  assert.equal(status.selected["yt-dlp"]?.origin, "system");
  assert.deepEqual(Object.keys(status.managed["yt-dlp"]!), ["2026.09.01"]);
});

const damaged: Array<[string, unknown]> = [
  ["only a schema", { schema: 1 }],
  ["entries of the wrong shape", { schema: 1, selected: [], managed: { "yt-dlp": { "2026.08.01": { worked: { youtube: 5, twitch: "2026-10-01T00:00:00.000Z" } }, "2026.09.01": null } } }],
  ["a list where helpers belong", { schema: 1, selected: { "yt-dlp": { origin: "elsewhere" } }, managed: { "yt-dlp": ["2026.08.01"] } }],
];
for (const [name, record] of damaged) test(`a status record with ${name} doesn't stop offline selection`, options, async t => {
  const f = fixture(t);
  f.cached("2026.08.01", true);
  f.cached("2026.09.01", true);
  mkdirSync(f.helpers, { recursive: true });
  writeFileSync(join(f.helpers, "status.json"), JSON.stringify(record));
  assert.equal((await f.status()).selected["yt-dlp"], undefined, "entries of the wrong shape are not reported");
  startHelpers(f.helpers);
  assert.equal(await helper("yt-dlp"), f.path("2026.09.01"));
  await until(async () => (await f.status()).selected["yt-dlp"]?.version === "2026.09.01", "the selection is recorded again");
  assert.deepEqual(f.copies(), ["2026.08.01", "2026.09.01"]);
  const kept = (await f.status()).managed["yt-dlp"]?.["2026.08.01"];
  assert.deepEqual(kept?.worked ?? {}, name === "entries of the wrong shape" ? { twitch: "2026-10-01T00:00:00.000Z" } : {});
});

test("a held copy Core was removing when it stopped is put back on restart", options, async t => {
  const f = fixture(t);
  f.cached("2026.08.01", true);
  f.release("2026.09.01", true);
  startHelpers(f.helpers);
  assert.equal(await helper("yt-dlp"), f.path("2026.09.01"));
  await helpersCommand(f.helpers, ["previous"]);

  // Core sets a copy aside before removing it; a stop right after that rename leaves this state.
  // A copy set aside that nothing holds is removed as before.
  renameSync(join(f.helpers, "yt-dlp", "2026.08.01"), join(f.helpers, "yt-dlp", "2026.08.01.removing"));
  f.cached("2026.07.01.removing", true);
  f.state.latest = null;
  startHelpers(f.helpers);
  assert.equal(await helper("yt-dlp"), f.path("2026.08.01"), "the restarted Core uses the held copy, offline too");
  assert.deepEqual(f.copies(), ["2026.08.01", "2026.09.01"]);
  assert.match(await f.play(), /extractor 2026\.08\.01/);
});

test("a renewal that fails while --helpers latest succeeds leaves the latest selected", options, async t => {
  const f = fixture(t);
  f.cached("2026.08.01", true);
  f.release("2026.09.01", true);
  startHelpers(f.helpers);
  assert.equal(await helper("yt-dlp"), f.path("2026.09.01"));
  await helpersCommand(f.helpers, ["previous"]);

  writeFileSync(join(f.directory, "probe-gate"), "2026.08.01!");
  const renewal = helpersCommand(f.helpers, ["previous", "2"]);
  await until(() => existsSync(join(f.directory, "probe-gate-held")), "the renewal is checking 2026.08.01");
  await helpersCommand(f.helpers, ["latest"]);
  rmSync(join(f.directory, "probe-gate-held"));
  await assert.rejects(renewal, /no earlier yt-dlp/);
  assert.equal((await f.status()).hold, null, "the failed renewal doesn't bring back the hold");
  assert.equal(await helper("yt-dlp"), f.path("2026.09.01"));
  assert.deepEqual(readdirSync(join(f.helpers, "pins")), [], "the renewal's pin is gone");
});

test("a hold written while an update decides on that copy keeps it, however their reads interleave", options, async t => {
  const f = fixture(t);
  f.cached("2026.08.01", true);
  f.release("2026.09.01", true);
  startHelpers(f.helpers);
  assert.equal(await helper("yt-dlp"), f.path("2026.09.01"));
  await f.play();
  await until(async () => !!(await f.status()).managed["yt-dlp"]?.["2026.09.01"]?.worked.youtube, "2026.09.01 worked, so an update would keep it and remove 2026.08.01");

  // The command has checked 2026.08.01 and waits to write its hold. The update sets 2026.08.01
  // aside, makes its first read of the pins or hold, and waits while the command finishes.
  const hold = join(f.helpers, "hold.json"), pins = join(f.helpers, "pins"), held = join(f.helpers, "yt-dlp", "2026.08.01");
  let committing = false, aside = false, deciding = false, commit = () => {}, decide = () => {};
  const committed = new Promise<void>(resolve => { commit = resolve; }), decided = new Promise<void>(resolve => { decide = resolve; });
  const { rename, readFile, readdir } = fsp;
  const after = async <T>(path: unknown, read: () => Promise<T>) => {
    const result = await read().then(value => ({ value }), (error: unknown) => ({ error }));
    if (aside && !deciding && (path === hold || path === pins)) { deciding = true; await decided; }
    if ("error" in result) throw result.error;
    return result.value;
  };
  const mocks = [
    t.mock.method(fsp, "rename", async (from: string, to: string) => {
      if (to === hold && !committing) { committing = true; await committed; }
      await rename(from, to);
      if (from === held && to === `${held}.removing`) aside = true;
    }),
    t.mock.method(fsp, "readFile", (...args: Parameters<typeof readFile>) => after(args[0], () => readFile(...args))),
    t.mock.method(fsp, "readdir", (...args: Parameters<typeof readdir>) => after(args[0], () => readdir(...args))),
  ];
  syncBuiltinESMExports();
  t.after(() => { for (const { mock } of mocks) mock.restore(); syncBuiltinESMExports(); });

  const recovering = helpersCommand(f.helpers, ["previous"]);
  await until(() => committing, "the command is writing its hold");
  f.release("2026.10.01", true);
  const daily = checkHelper("yt-dlp");
  await until(() => deciding, "the update is deciding whether to keep 2026.08.01");
  commit();
  assert.match(await recovering, /^Couch uses yt-dlp 2026\.08\.01 from its next run/);
  assert.deepEqual(await readdir(pins), [], "the command has handed its pin over to the hold");
  decide();
  assert.equal(await daily, f.path("2026.10.01"));
  assert.ok(existsSync(f.path("2026.08.01")), "the held copy is still there");
  assert.match(await f.play(), /extractor 2026\.08\.01/);
  assert.equal((await f.status()).selected["yt-dlp"]?.held, true);
});

test("--helpers previous renews a hold Core has applied, with the held copy", options, async t => {
  const f = fixture(t);
  f.cached("2026.08.01", true);
  f.release("2026.09.01", true);
  startHelpers(f.helpers);
  assert.equal(await helper("yt-dlp"), f.path("2026.09.01"));
  await helpersCommand(f.helpers, ["previous"]);
  assert.equal(await f.play(), "extractor 2026.08.01");
  assert.equal((await f.status()).selected["yt-dlp"]?.held, true);

  assert.match(await helpersCommand(f.helpers, ["previous", "2"]), /^Couch uses yt-dlp 2026\.08\.01, which worked before, from its next run until /);
  const { hold } = await f.status();
  assert.equal((Date.parse(hold!.until) - Date.parse(hold!.since)) / 86_400_000, 2);
  assert.equal(await f.play(), "extractor 2026.08.01");
});

test("only playable media counts as a copy having worked, so an update keeps the copy that played", options, async t => {
  const f = fixture(t);
  f.release("2026.08.01", true);
  startHelpers(f.helpers);
  assert.equal(await f.play(), "extractor 2026.08.01");

  // 2026.09.01 exits cleanly, but with media information Couch can't play.
  f.release("2026.09.01", "unusable");
  assert.equal(await checkHelper("yt-dlp"), f.path("2026.09.01"));
  await assert.rejects(f.play(), /Web media must use/);
  assert.equal((await inspectWebMedia(video)).title, "extractor 2026.09.01", "reading the page's details works");
  assert.match(await runYtDlp(["--flat-playlist", "--dump-single-json", "--", video]), /extractor 2026\.09\.01/, "and so does listing");
  assert.deepEqual((await f.status()).managed["yt-dlp"]?.["2026.09.01"]?.worked, {}, "neither is playback");

  f.release("2026.10.01", true);
  assert.equal(await checkHelper("yt-dlp"), f.path("2026.10.01"));
  assert.deepEqual(f.copies(), ["2026.08.01", "2026.10.01"], "the copy that played is the previous one");
  assert.match(await helpersCommand(f.helpers, ["previous"]), /^Couch uses yt-dlp 2026\.08\.01, which worked before,/);
});

test("a run that ends while an update decides which copies to keep stays until the next check", options, async t => {
  const f = fixture(t);
  f.release("2026.08.01", true);
  startHelpers(f.helpers);
  assert.equal(await f.play(), "extractor 2026.08.01");
  f.release("2026.09.01", true);
  await checkHelper("yt-dlp");
  f.block(true);
  const running = f.play();
  await until(() => f.runs().length === 2, "the extraction started on 2026.09.01");

  // The update reads which copies have worked, when only 2026.08.01 has; then the run on
  // 2026.09.01 ends and records that it played, before the update removes anything.
  const status = join(f.helpers, "status.json"), { readFile } = fsp;
  let armed = true, reading = false, resume = () => {};
  const resumed = new Promise<void>(resolve => { resume = resolve; });
  const mock = t.mock.method(fsp, "readFile", async (...args: Parameters<typeof readFile>) => {
    const result = await readFile(...args);
    if (armed && args[0] === status) { armed = false; reading = true; await resumed; }
    return result;
  });
  syncBuiltinESMExports();
  t.after(() => { mock.mock.restore(); syncBuiltinESMExports(); });

  f.release("2026.10.01", true);
  const daily = checkHelper("yt-dlp");
  await until(() => reading, "the update has read which copies worked");
  f.block(false);
  assert.equal(await running, "extractor 2026.09.01");
  resume();
  assert.equal(await daily, f.path("2026.10.01"));
  assert.deepEqual(f.copies(), ["2026.08.01", "2026.09.01", "2026.10.01"], "the copy whose run ended during the check stays");
  assert.ok((await f.status()).managed["yt-dlp"]?.["2026.09.01"]?.worked.youtube, "with what its run recorded");
  assert.equal(await checkHelper("yt-dlp"), f.path("2026.10.01"));
  assert.deepEqual(f.copies(), ["2026.09.01", "2026.10.01"], "the next check keeps it as the previous copy");
});

test("a managed copy of PATH's version never takes the place of an earlier copy that worked", options, async t => {
  const f = fixture(t);
  f.release("2026.08.01", true);
  startHelpers(f.helpers);
  assert.equal(await f.play(), "extractor 2026.08.01");
  f.release("2026.09.01", true);
  await checkHelper("yt-dlp");
  assert.equal(await f.play(), "extractor 2026.09.01");

  // The package manager catches up with the copy Couch downloaded.
  const system = join(f.directory, "bin", "yt-dlp");
  writeFileSync(system, program(f.directory, "2026.09.01", true), { mode: 0o755 });
  assert.equal(await checkHelper("yt-dlp"), system);
  assert.deepEqual(f.copies(), ["2026.08.01"], "PATH provides 2026.09.01; the earlier copy that worked stays");
  assert.match(await helpersCommand(f.helpers, ["previous"]), /^Couch uses yt-dlp 2026\.08\.01, which worked before,/);
  assert.equal(await f.play(), "extractor 2026.08.01");
});

test("overlapping --helpers commands: Core uses the last write, and a command that sees a later change says so", options, async t => {
  const f = fixture(t);
  f.cached("2026.08.01", true);
  f.release("2026.09.01", true);
  startHelpers(f.helpers);
  assert.equal(await helper("yt-dlp"), f.path("2026.09.01"));

  // One command stops right after its first removal under `prefix`, or after its next read of the
  // hold (its last look at it), while the other runs to the end.
  const hold = join(f.helpers, "hold.json"), { rm, readFile } = fsp;
  let prefix = "", afterRead = false, removed = false, reached = false, resume = () => {};
  const stop = async () => { reached = true; await new Promise<void>(resolve => { resume = resolve; }); };
  const mocks = [
    t.mock.method(fsp, "rm", async (...args: Parameters<typeof rm>) => {
      await rm(...args);
      if (prefix && String(args[0]).startsWith(prefix)) { prefix = ""; if (afterRead) removed = true; else await stop(); }
    }),
    t.mock.method(fsp, "readFile", async (...args: Parameters<typeof readFile>) => {
      const result = await readFile(...args).then(value => ({ value }), (error: unknown) => ({ error }));
      if (removed && args[0] === hold) { removed = false; await stop(); }
      if ("error" in result) throw result.error;
      return result.value;
    }),
  ];
  syncBuiltinESMExports();
  t.after(() => { for (const { mock } of mocks) mock.restore(); syncBuiltinESMExports(); });
  const pause = async (at: string, read: boolean, command: string) => {
    [prefix, afterRead, reached] = [at, read, false];
    const paused = helpersCommand(f.helpers, [command]);
    paused.catch(() => {});
    await until(() => reached, `${command} is paused`);
    return { paused };
  };
  const pins = join(f.helpers, "pins");

  // `previous` has written its hold and is removing its pin when `latest` removes the hold.
  let { paused } = await pause(pins, false, "previous");
  assert.match(await helpersCommand(f.helpers, ["latest"]), /^Couch returns to the latest/);
  resume();
  await assert.rejects(paused, /^Error: Couch held yt-dlp 2026\.08\.01, but a --helpers command run at the same time has changed the hold since/);
  assert.equal((await f.status()).hold, null);
  assert.equal(await helper("yt-dlp"), f.path("2026.09.01"));

  // `latest` has removed the hold and is flushing that when `previous` holds a copy.
  ({ paused } = await pause(hold, false, "latest"));
  assert.match(await helpersCommand(f.helpers, ["previous"]), /^Couch uses yt-dlp 2026\.08\.01 from its next run/);
  resume();
  await assert.rejects(paused, /^Error: Couch removed the hold, but a --helpers previous run at the same time has held yt-dlp 2026\.08\.01 since/);
  assert.equal((await f.status()).hold?.active, true);
  assert.equal(await helper("yt-dlp"), f.path("2026.08.01"));

  // A command that overlaps after the other's last look isn't seen: both report their own change,
  // and Core uses the last write. Neither restores what it saw over that write.
  ({ paused } = await pause(pins, true, "previous"));
  assert.match(await helpersCommand(f.helpers, ["latest"]), /^Couch returns to the latest/);
  resume();
  assert.match(await paused, /^Couch uses yt-dlp 2026\.08\.01 .* A --helpers command run at the same time can replace this; --helpers status shows the current hold\.$/);
  assert.equal((await f.status()).hold, null);
  assert.equal(await helper("yt-dlp"), f.path("2026.09.01"));

  ({ paused } = await pause(hold, true, "latest"));
  assert.match(await helpersCommand(f.helpers, ["previous"]), /^Couch uses yt-dlp 2026\.08\.01 from its next run/);
  resume();
  assert.match(await paused, /^Couch returns to the latest yt-dlp from its next run\. A --helpers command run at the same time can replace this/);
  assert.equal((await f.status()).hold?.active, true);
  assert.equal(await helper("yt-dlp"), f.path("2026.08.01"));
  assert.deepEqual(readdirSync(pins), []);
});

test("media rejected after yt-dlp's output was read, such as a live stream's fallback, doesn't count as having worked", options, async t => {
  const f = fixture(t);
  f.release("2026.08.01", true);
  startHelpers(f.helpers);
  assert.equal(await f.play(), "extractor 2026.08.01");
  f.release("2026.09.01", true);
  await checkHelper("yt-dlp");

  // 2026.09.01 offers a live variant playlist that answers 403, and no master playlist to fall back to.
  writeFileSync(f.path("2026.09.01"), `#!${process.execPath}\nconsole.log(process.argv[2] === "--version" ? "2026.09.01" : ${JSON.stringify(JSON.stringify({ url: "https://media.example/live.m3u8", protocol: "m3u8_native", is_live: true, manifest_url: "", title: "live" }))});\n`, { mode: 0o755 });
  t.mock.method(https, "request", (_url: unknown, _options: unknown, answer: (response: unknown) => void) => {
    const request = new PassThrough();
    request.once("finish", () => answer(Object.assign(Readable.from([]), { statusCode: 403, statusMessage: "Forbidden", rawHeaders: [], headers: {} })));
    return request;
  });
  await assert.rejects(f.play(), /Web media must use/);
  assert.deepEqual((await f.status()).managed["yt-dlp"]?.["2026.09.01"]?.worked, {});
  f.release("2026.10.01", true);
  await checkHelper("yt-dlp");
  assert.deepEqual(f.copies(), ["2026.08.01", "2026.10.01"], "the copy that played is the previous one");
});

test("renewing a hold keeps the held copy while it runs, even when an older copy has worked since", options, async t => {
  const f = fixture(t);
  f.cached("2026.07.01", true);
  f.release("2026.08.01", true);
  startHelpers(f.helpers);
  await helper("yt-dlp");
  await helpersCommand(f.helpers, ["previous"]);
  assert.equal(await helper("yt-dlp"), f.path("2026.07.01"));

  // A playback on July is still running when the operator returns to the latest and an update brings September.
  f.block(true);
  const older = f.play();
  await until(() => f.runs().length === 1, "the playback started on 2026.07.01");
  f.release("2026.09.01", true);
  await helpersCommand(f.helpers, ["latest"]);
  assert.equal(await checkHelper("yt-dlp"), f.path("2026.09.01"));
  assert.deepEqual(f.copies(), ["2026.07.01", "2026.08.01", "2026.09.01"], "August is the previous copy; July is in use");
  assert.match(await helpersCommand(f.helpers, ["previous"]), /^Couch uses yt-dlp 2026\.08\.01 from/);
  f.block(false);
  assert.equal(await older, "extractor 2026.07.01");
  assert.ok((await f.status()).managed["yt-dlp"]?.["2026.07.01"]?.worked.youtube, "July has worked, August hasn't");

  // Renewed before Core applies the hold, and again after.
  assert.match(await helpersCommand(f.helpers, ["previous", "2"]), /^Couch uses yt-dlp 2026\.08\.01 from/);
  assert.equal(await helper("yt-dlp"), f.path("2026.08.01"));
  assert.equal((await f.status()).selected["yt-dlp"]?.held, true);
  assert.match(await helpersCommand(f.helpers, ["previous", "3"]), /^Couch uses yt-dlp 2026\.08\.01 from/);
  const { hold } = await f.status();
  assert.equal(hold?.version, "2026.08.01");
  assert.equal((Date.parse(hold!.until) - Date.parse(hold!.since)) / 86_400_000, 3);
  assert.equal(await checkHelper("yt-dlp"), f.path("2026.08.01"));
  assert.deepEqual(f.copies(), ["2026.07.01", "2026.08.01"], "the held copy, and July as the previous copy that worked");

  // A held copy that no longer runs isn't renewed; the earlier copy that worked is held instead.
  writeFileSync(f.path("2026.08.01"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  assert.match(await helpersCommand(f.helpers, ["previous"]), /^Couch uses yt-dlp 2026\.07\.01, which worked before,/);
});

test("renewing keeps the hold in force when overlapping commands left it newer than Core's held selection", options, async t => {
  const f = fixture(t);
  f.cached("2026.07.01", true);
  f.release("2026.08.01", true);
  startHelpers(f.helpers);
  await helper("yt-dlp");
  await helpersCommand(f.helpers, ["previous"]);
  assert.equal(await helper("yt-dlp"), f.path("2026.07.01"));
  f.block(true);
  const older = f.play();
  await until(() => f.runs().length === 1, "the playback started on 2026.07.01");
  await helpersCommand(f.helpers, ["latest"]);
  f.release("2026.09.01", true);
  assert.equal(await checkHelper("yt-dlp"), f.path("2026.09.01"));

  // One command chooses August, before July has worked, and is still checking it when July's
  // playback ends and a second command holds July, which Core applies.
  writeFileSync(join(f.directory, "probe-gate"), "2026.08.01");
  const august = helpersCommand(f.helpers, ["previous", "2"]);
  await until(() => existsSync(join(f.directory, "probe-gate-held")), "the first command is checking 2026.08.01");
  f.block(false);
  assert.equal(await older, "extractor 2026.07.01");
  assert.match(await helpersCommand(f.helpers, ["previous", "3"]), /^Couch uses yt-dlp 2026\.07\.01, which worked before,/);
  assert.equal(await helper("yt-dlp"), f.path("2026.07.01"));

  // The first command writes last, so August is held while Core's record still names July.
  rmSync(join(f.directory, "probe-gate-held"));
  assert.match(await august, /^Couch uses yt-dlp 2026\.08\.01 from/);
  let status = await f.status();
  assert.equal(status.hold?.version, "2026.08.01");
  assert.deepEqual([status.selected["yt-dlp"]?.version, status.selected["yt-dlp"]?.held], ["2026.07.01", true]);

  assert.match(await helpersCommand(f.helpers, ["previous", "4"]), /^Couch uses yt-dlp 2026\.08\.01 from/);
  status = await f.status();
  assert.equal(status.hold?.version, "2026.08.01");
  assert.equal((Date.parse(status.hold!.until) - Date.parse(status.hold!.since)) / 86_400_000, 4);
  assert.equal(await checkHelper("yt-dlp"), f.path("2026.08.01"));
  assert.deepEqual(f.copies(), ["2026.07.01", "2026.08.01"], "the held copy, and July as the previous copy that worked");
});
