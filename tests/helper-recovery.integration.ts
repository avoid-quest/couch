import { test, type TestContext } from "node:test";
import { executableName, nodeExecutables } from "./executable.fixture";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import { checkHelper, helper, helpersCommand, startHelpers } from "../src/server/helpers";
import { readHelperStatus, updateStatus } from "../src/server/helper-status";
import { ExtractionError, runYtDlp } from "../src/server/yt-dlp";
import { inspectWebMedia, resolveWebMedia } from "../src/server/web-media";

// Core's helper selection and yt-dlp runs with real fixture executables in a private PATH and
// data directory. Node launches the executable fixtures; GitHub is replaced with real
// zips checked against their SHA-256. No installed Couch or its data is touched.
const video = "https://www.youtube.com/watch?v=couch";

// A stand-in yt-dlp: prints its version, or "extracts" by reading a file from its own copy,
// so a copy removed mid-run fails. A copy that works returns playable media titled with that
// file; an "unusable" one exits cleanly with media information Couch can't play. It waits
// while `<dir>/block` exists, and logs each run.
function program(directory: string, version: string, works: boolean | "unusable") {
  return `#!${process.execPath}
const fs = process.getBuiltinModule("node:fs"), path = process.getBuiltinModule("node:path");
const version = ${JSON.stringify(version)}, here = path.dirname(fs.realpathSync(process.argv[1]));
if (process.argv[2] === "--version") console.log(version);
else {
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
  const fixtures = nodeExecutables(directory);
  const bin = join(directory, "bin"),
    helpers = join(directory, "helpers");
  const originalPath = process.env.PATH,
    originalCertificates = process.env.SSL_CERT_FILE,
    originalData = process.env.COUCH_DATA_DIR;
  const timers: ReturnType<typeof setInterval>[] = [],
    set = globalThis.setInterval;
  t.mock.method(globalThis, "setInterval", (...args: Parameters<typeof setInterval>) => {
    const timer = set(...args);
    timers.push(timer);
    return timer;
  });
  t.after(async () => {
    for (const timer of timers) clearInterval(timer);
    // Status writes are serialized; this one lands after any a run left pending.
    await updateStatus(helpers, () => {});
    for (const [key, value] of Object.entries({
      PATH: originalPath,
      SSL_CERT_FILE: originalCertificates,
      COUCH_DATA_DIR: originalData,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fixtures.close();
    rmSync(directory, { recursive: true, force: true });
  });
  mkdirSync(bin);
  writeFileSync(
    join(bin, executableName("qjs")),
    `#!${process.execPath}\nconsole.log("0.17.0");\n`,
    { mode: 0o755 },
  );
  writeFileSync(
    join(bin, executableName("ffmpeg")),
    `#!${process.execPath}\nconsole.log("ffmpeg version 7.0");\n`,
    { mode: 0o755 },
  );
  process.env.PATH = bin;
  process.env.COUCH_DATA_DIR = directory;

  // GitHub's latest yt-dlp release, served as a real zip with its recorded SHA-256; null is offline.
  const releases = new Map<string, Uint8Array>();
  const state = { latest: null as string | null, requests: [] as string[] };
  const release = (version: string, works: boolean | "unusable") => {
    releases.set(
      version,
      zipSync({
        [executableName("yt-dlp")]: strToU8(program(directory, version, works)),
        "_internal/extractor": strToU8(`extractor ${version}`),
      }),
    );
    state.latest = version;
    return createHash("sha256").update(releases.get(version)!).digest("hex");
  };
  t.mock.method(globalThis, "fetch", async (url: string) => {
    state.requests.push(url);
    const download = /\/download\/([^/]+)\//.exec(url)?.[1];
    if (!state.latest) throw new Error("Network unavailable");
    if (download) return new Response(releases.get(download));
    return Response.json({
      tag_name: state.latest,
      assets: [
        "yt-dlp_macos.zip",
        "yt-dlp_linux.zip",
        "yt-dlp_linux_aarch64.zip",
        "yt-dlp_win.zip",
        "yt-dlp_win_arm64.zip",
      ].map((name) => ({
        name,
        browser_download_url: `https://github.com/yt-dlp/yt-dlp/releases/download/${state.latest}/${name}`,
        digest: `sha256:${createHash("sha256").update(releases.get(state.latest!)!).digest("hex")}`,
      })),
    });
  });
  t.mock.method(console, "error", () => {});

  // A copy already in Couch's cache, as an earlier Couch left it.
  const cached = (version: string, works: boolean | "unusable") => {
    mkdirSync(join(helpers, "yt-dlp", version, "_internal"), { recursive: true });
    writeFileSync(
      join(helpers, "yt-dlp", version, executableName("yt-dlp")),
      program(directory, version, works),
      { mode: 0o755 },
    );
    writeFileSync(
      join(helpers, "yt-dlp", version, "_internal", "extractor"),
      `extractor ${version}`,
    );
  };
  const path = (version: string) => join(helpers, "yt-dlp", version, executableName("yt-dlp"));
  const copies = () => readdirSync(join(helpers, "yt-dlp")).sort();
  const runs = () =>
    existsSync(join(directory, "runs"))
      ? readFileSync(join(directory, "runs"), "utf8").trim().split("\n")
      : [];
  const status = () => readHelperStatus(helpers);
  const block = (on: boolean) =>
    on
      ? writeFileSync(join(directory, "block"), "")
      : rmSync(join(directory, "block"), { force: true });
  // Playback resolution, the run that records whether a copy worked; its media's title names the copy's file.
  const play = async (url = video) => (await resolveWebMedia(url)).metadata?.title;
  return { directory, helpers, state, release, cached, path, copies, runs, status, block, play };
}

async function until(condition: () => boolean | Promise<boolean>, message: string) {
  const deadline = Date.now() + 5_000;
  while (!(await condition())) {
    if (Date.now() > deadline) assert.fail(message);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

const options = { timeout: 20_000 };

test(
  "a runnable update that fails extraction stays selected until the operator chooses the copy that worked",
  options,
  async (t) => {
    const f = fixture(t);
    f.release("2026.08.01", true);
    startHelpers(f.helpers);
    assert.match(await f.play(), /extractor 2026\.08\.01/);
    await until(
      async () => !!(await f.status()).managed["yt-dlp"]?.["2026.08.01"]?.worked.youtube,
      "a successful extraction is recorded for the copy that ran it",
    );

    // The daily check installs a newer release that runs (--version) but breaks extraction.
    const digest = f.release("2026.09.01", false);
    assert.equal(await checkHelper("yt-dlp"), f.path("2026.09.01"));
    await assert.rejects(f.play(), ExtractionError);
    await assert.rejects(f.play(), ExtractionError);
    assert.equal(
      await helper("yt-dlp"),
      f.path("2026.09.01"),
      "a website's 403 never downgrades yt-dlp by itself",
    );
    let status = await f.status();
    assert.deepEqual(status.selected["yt-dlp"], {
      ...status.selected["yt-dlp"],
      origin: "managed",
      version: "2026.09.01",
      path: f.path("2026.09.01"),
      sha256: digest,
      latest: "2026.09.01",
      held: false,
    });
    assert.ok(Date.parse(status.selected["yt-dlp"]!.verifiedAt) > 0);
    assert.deepEqual(
      status.managed["yt-dlp"]?.["2026.09.01"]?.worked,
      {},
      "running is not the same as having worked",
    );
    assert.deepEqual(
      f.copies(),
      ["2026.08.01", "2026.09.01"],
      "the copy that worked is kept as the previous one",
    );

    const before = f.state.requests.length;
    const message = await helpersCommand(f.helpers, ["previous"]);
    assert.match(message, /2026\.08\.01, which worked before,/);
    assert.equal(f.state.requests.length, before, "choosing the previous copy downloads nothing");
    assert.match(
      await f.play(),
      /extractor 2026\.08\.01/,
      "the next run uses the held copy without a restart",
    );
    assert.deepEqual(f.runs(), ["2026.08.01", "2026.09.01", "2026.09.01", "2026.08.01"]);
    status = await f.status();
    assert.equal(status.selected["yt-dlp"]?.held, true);
    assert.equal(status.selected["yt-dlp"]?.path, f.path("2026.08.01"));
    assert.equal(status.hold?.active, true);
    const days = (Date.parse(status.hold!.until) - Date.parse(status.hold!.since)) / 86_400_000;
    assert.equal(days, 7);
  },
);

test(
  "a hold survives restarts and daily checks, and ends with --helpers latest or when it expires",
  options,
  async (t) => {
    const f = fixture(t);
    f.cached("2026.08.01", true);
    f.release("2026.09.01", true);
    startHelpers(f.helpers);
    assert.equal(await helper("yt-dlp"), f.path("2026.09.01"));
    assert.match(
      await helpersCommand(f.helpers, ["previous", "2"]),
      /^Couch uses yt-dlp 2026\.08\.01 from its next run until /,
    );

    // A restart and a newer release don't replace the operator's choice, nor check for one.
    f.release("2026.09.02", true);
    const before = f.state.requests.length;
    startHelpers(f.helpers);
    assert.equal(await helper("yt-dlp"), f.path("2026.08.01"));
    assert.equal(await checkHelper("yt-dlp"), f.path("2026.08.01"));
    assert.equal(f.state.requests.length, before);
    assert.deepEqual(f.copies(), ["2026.08.01", "2026.09.01"]);

    assert.match(
      await helpersCommand(f.helpers, ["latest"]),
      /^Couch returns to the latest yt-dlp from its next run\. A --helpers command run at the same time can replace this; --helpers status shows the current hold\.$/,
    );
    assert.match(await f.play(), /extractor 2026\.09\.02/);
    assert.equal((await f.status()).hold, null);
    assert.deepEqual(f.copies(), ["2026.09.01", "2026.09.02"], "at most one previous copy is kept");

    await helpersCommand(f.helpers, ["previous"]);
    assert.equal(await helper("yt-dlp"), f.path("2026.09.01"));
    const hold = JSON.parse(readFileSync(join(f.helpers, "hold.json"), "utf8"));
    writeFileSync(
      join(f.helpers, "hold.json"),
      JSON.stringify({ ...hold, until: new Date(Date.now() - 1000).toISOString() }),
    );
    assert.equal(
      await helper("yt-dlp"),
      f.path("2026.09.02"),
      "an expired hold returns to the latest",
    );
    assert.equal((await f.status()).hold?.active, false);
    assert.equal((await f.status()).selected["yt-dlp"]?.held, false);

    await assert.rejects(helpersCommand(f.helpers, ["previous", "31"]), /Usage/);
    await assert.rejects(helpersCommand(f.helpers, ["previous", "0"]), /Usage/);
  },
);

test(
  "offline, the newest cached copy is selected, recorded as unchecked, and the passive status changes nothing",
  options,
  async (t) => {
    const f = fixture(t);
    f.cached("2026.08.01", true);
    f.cached("2026.09.01", true);
    startHelpers(f.helpers);
    assert.equal(await helper("yt-dlp"), f.path("2026.09.01"));
    await until(
      async () => Object.keys((await f.status()).selected).length === 3,
      "every helper's selection is recorded",
    );
    const status = await f.status();
    assert.deepEqual(status.selected["yt-dlp"], {
      ...status.selected["yt-dlp"],
      origin: "managed",
      version: "2026.09.01",
      sha256: null,
      latest: null,
      held: false,
    });
    assert.equal(status.selected.qjs?.origin, "system");
    assert.equal(status.selected.qjs?.version, "0.17.0");
    assert.equal(status.selected.ffmpeg?.path, join(f.directory, "bin", executableName("ffmpeg")));
    assert.deepEqual(f.copies(), ["2026.08.01", "2026.09.01"]);

    // A newer release appearing doesn't change what the passive view reports as selected.
    f.release("2026.10.01", true);
    const requests = f.state.requests.length;
    assert.deepEqual(JSON.parse(await helpersCommand(f.helpers, ["status"])), status);
    assert.equal(f.state.requests.length, requests);
    assert.deepEqual(f.copies(), ["2026.08.01", "2026.09.01"]);
    assert.deepEqual(f.runs(), [], "the status view runs no helper");
  },
);

test("an interrupted download or status write is discarded and repaired", options, async (t) => {
  const f = fixture(t);
  f.cached("2026.08.01", true);
  f.cached("2026.09.01.partial", true);
  mkdirSync(f.helpers, { recursive: true });
  writeFileSync(join(f.helpers, "status.json"), '{"schema":1,"selected":{"yt-d');
  writeFileSync(join(f.helpers, "status.json.4242.tmp"), "{");
  startHelpers(f.helpers);
  assert.equal(await helper("yt-dlp"), f.path("2026.08.01"));
  assert.deepEqual(f.copies(), ["2026.08.01"], "a copy that was never promoted is never used");
  await until(
    async () => (await f.status()).selected["yt-dlp"]?.version === "2026.08.01",
    "a truncated status is rewritten",
  );

  const digest = f.release("2026.09.01", true);
  assert.equal(await checkHelper("yt-dlp"), f.path("2026.09.01"));
  assert.equal((await f.status()).selected["yt-dlp"]?.sha256, digest);
  assert.match(await f.play(), /extractor 2026\.09\.01/);
});

test(
  "a missing or broken previous copy is never held, and a held copy that disappears returns to the latest",
  options,
  async (t) => {
    const f = fixture(t);
    f.cached("2026.08.01", true);
    f.release("2026.09.01", true);
    startHelpers(f.helpers);
    assert.equal(await helper("yt-dlp"), f.path("2026.09.01"));
    await until(async () => !!(await f.status()).selected["yt-dlp"], "the selection is recorded");
    await helpersCommand(f.helpers, ["previous"]);
    assert.equal(await helper("yt-dlp"), f.path("2026.08.01"));

    rmSync(join(f.helpers, "yt-dlp", "2026.08.01"), { recursive: true });
    assert.equal(
      await helper("yt-dlp"),
      f.path("2026.09.01"),
      "a missing held copy is repaired with the latest",
    );
    assert.equal((await f.status()).selected["yt-dlp"]?.held, false);
    assert.equal(
      (await f.status()).hold?.active,
      true,
      "the operator's hold is left for them to end",
    );
    await assert.rejects(
      helpersCommand(f.helpers, ["previous"]),
      /no earlier yt-dlp than 2026\.09\.01/,
    );
    assert.equal(
      (await f.status()).hold?.version,
      "2026.08.01",
      "a failed command leaves the earlier hold as it was",
    );

    // A copy that no longer runs isn't offered either.
    await helpersCommand(f.helpers, ["latest"]);
    f.cached("2026.08.01", true);
    writeFileSync(f.path("2026.08.01"), `#!${process.execPath}\nprocess.exit(1);\n`, {
      mode: 0o755,
    });
    await assert.rejects(helpersCommand(f.helpers, ["previous"]), /no earlier yt-dlp/);
    assert.equal(existsSync(join(f.helpers, "hold.json")), false);
  },
);

test(
  "an extraction still running on a replaced copy keeps it until it finishes",
  options,
  async (t) => {
    const f = fixture(t);
    f.release("2026.08.01", true);
    startHelpers(f.helpers);
    await f.play();
    await until(
      async () => !!(await f.status()).managed["yt-dlp"]?.["2026.08.01"]?.worked.youtube,
      "the first copy worked",
    );
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
    assert.match(
      await running,
      /extractor 2026\.09\.01/,
      "the older run reads its own files to the end",
    );
    assert.match(await f.play("https://www.twitch.tv/couch"), /extractor 2026\.10\.01/);
    assert.deepEqual(f.runs(), ["2026.08.01", "2026.09.01", "2026.10.01"]);

    // The next check prunes again; 2026.09.01 has now worked, so it is the previous copy.
    await until(
      async () => !!(await f.status()).managed["yt-dlp"]?.["2026.09.01"]?.worked.youtube,
      "the finished run is recorded",
    );
    await checkHelper("yt-dlp");
    assert.deepEqual(f.copies(), ["2026.09.01", "2026.10.01"]);
    assert.deepEqual(Object.keys((await f.status()).managed["yt-dlp"]!).sort(), [
      "2026.09.01",
      "2026.10.01",
    ]);
  },
);

test(
  "a status record with entries of the wrong shape doesn't stop offline selection",
  options,
  async (t) => {
    const record = {
      schema: 1,
      selected: [],
      managed: {
        "yt-dlp": {
          "2026.08.01": { worked: { youtube: 5, twitch: "2026-10-01T00:00:00.000Z" } },
          "2026.09.01": null,
        },
      },
    };
    const f = fixture(t);
    f.cached("2026.08.01", true);
    f.cached("2026.09.01", true);
    mkdirSync(f.helpers, { recursive: true });
    writeFileSync(join(f.helpers, "status.json"), JSON.stringify(record));
    assert.equal(
      (await f.status()).selected["yt-dlp"],
      undefined,
      "entries of the wrong shape are not reported",
    );
    startHelpers(f.helpers);
    assert.equal(await helper("yt-dlp"), f.path("2026.09.01"));
    await until(
      async () => (await f.status()).selected["yt-dlp"]?.version === "2026.09.01",
      "the selection is recorded again",
    );
    assert.deepEqual(f.copies(), ["2026.08.01", "2026.09.01"]);
    const kept = (await f.status()).managed["yt-dlp"]?.["2026.08.01"];
    assert.deepEqual(kept?.worked, { twitch: "2026-10-01T00:00:00.000Z" });
  },
);

test(
  "only playable media counts as a copy having worked, so an update keeps the copy that played",
  options,
  async (t) => {
    const f = fixture(t);
    f.release("2026.08.01", true);
    startHelpers(f.helpers);
    assert.equal(await f.play(), "extractor 2026.08.01");

    // 2026.09.01 exits cleanly, but with media information Couch can't play.
    f.release("2026.09.01", "unusable");
    assert.equal(await checkHelper("yt-dlp"), f.path("2026.09.01"));
    await assert.rejects(f.play(), /Web media must use/);
    assert.equal(
      (await inspectWebMedia(video)).title,
      "extractor 2026.09.01",
      "reading the page's details works",
    );
    assert.match(
      await runYtDlp(["--flat-playlist", "--dump-single-json", "--", video]),
      /extractor 2026\.09\.01/,
      "and so does listing",
    );
    assert.deepEqual(
      (await f.status()).managed["yt-dlp"]?.["2026.09.01"]?.worked,
      {},
      "neither is playback",
    );

    f.release("2026.10.01", true);
    assert.equal(await checkHelper("yt-dlp"), f.path("2026.10.01"));
    assert.deepEqual(
      f.copies(),
      ["2026.08.01", "2026.10.01"],
      "the copy that played is the previous one",
    );
    assert.match(
      await helpersCommand(f.helpers, ["previous"]),
      /^Couch uses yt-dlp 2026\.08\.01, which worked before,/,
    );
  },
);
