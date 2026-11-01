import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { helper, startHelpers } from "../src/server/helpers";
import { createBandcampCatalog } from "../src/server/providers/bandcamp";
import { bandcampSearchPlugin } from "../src/server/bandcamp";
import fixture from "./fixtures/bandcamp-extractor.py" with { type: "text" };

test("Node searches Bandcamp through the managed helper, then removes its private plugin", { skip: process.platform === "win32" }, async t => {
  const directory = mkdtempSync(join(tmpdir(), "couch-bandcamp-")), bin = join(directory, "bin");
  mkdirSync(bin);
  const before = { PATH: process.env.PATH, COUCH_DATA_DIR: process.env.COUCH_DATA_DIR, SSL_CERT_FILE: process.env.SSL_CERT_FILE };
  let startup: Promise<unknown> | undefined;
  const timers: ReturnType<typeof setInterval>[] = [], set = globalThis.setInterval;
  t.mock.method(globalThis, "setInterval", (...args: Parameters<typeof setInterval>) => { const timer = set(...args); timers.push(timer); return timer; });
  t.after(async () => {
    for (const timer of timers) clearInterval(timer);
    await startup;
    for (const [key, value] of Object.entries(before)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    rmSync(directory, { recursive: true, force: true });
  });
  const captured = join(directory, "arguments.json");
  for (const [name, version] of [["yt-dlp", "2099.01.01"], ["qjs", "0.18.0"], ["ffmpeg", "ffmpeg version 9.0.2"]]) {
    writeFileSync(join(bin, name!), `#!${process.execPath}
const args = process.argv.slice(2);
if (!args.includes("--dump-single-json")) console.log(${JSON.stringify(version)});
else {
  require("node:fs").writeFileSync(${JSON.stringify(captured)}, JSON.stringify(args));
  console.log(JSON.stringify({couch_bandcamp_search: JSON.stringify({results:[{type:"t",name:"Track",url:"https://artist.bandcamp.comhttps://artist.bandcamp.com/track/track"}]})}));
}
`, { mode: 0o755 });
  }
  process.env.PATH = bin;
  process.env.COUCH_DATA_DIR = directory;
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Direct Node fetch must not perform Bandcamp search"); });
  startHelpers(join(directory, "helpers"));
  startup = Promise.allSettled((["yt-dlp", "qjs", "ffmpeg"] as const).map(helper));
  const page = await createBandcampCatalog().browse({ query: "artist" });
  assert.equal(page.items[0]?.url, "https://artist.bandcamp.com/track/track");
  const args: string[] = JSON.parse(readFileSync(captured, "utf8"));
  assert.equal(args.at(-1), "https://bandcamp.com/api/fuzzysearch/1/app_autocomplete?q=artist");
  assert.equal(args[args.lastIndexOf("--retries") + 1], "0");
  assert.equal(args[args.lastIndexOf("--extractor-retries") + 1], "0");
  assert.ok(args.includes("--no-plugin-dirs"));
  assert.ok(args.includes("--proxy"));
  assert.ok(args.includes("--plugin-dirs"));
  const plugin = args[args.indexOf("--plugin-dirs") + 1]!;
  assert.ok(plugin);
  assert.throws(() => readFileSync(join(plugin, "bundled", "yt_dlp_plugins", "extractor", "bandcamp.py")), /ENOENT/);
});

test("real yt-dlp passes Bandcamp JSON and challenge HTML through with a single request", { skip: !process.env.COUCH_TEST_YT_DLP }, async () => {
  const plugin = await bandcampSearchPlugin();
  try {
    writeFileSync(join(plugin.directory, "bundled", "yt_dlp_plugins", "extractor", "offline.py"), fixture);
    for (const [kind, body] of [["json", '{"results":[]}'], ["html", "<title>Client Challenge</title>"]]) {
      const { stdout } = await promisify(execFile)(process.env.COUCH_TEST_YT_DLP!, ["--ignore-config", "--no-cache-dir", "--no-plugin-dirs", "--plugin-dirs", plugin.directory,
        "--use-extractors", "CouchBandcampSearchTest,end", "--skip-download", "--dump-single-json", "--flat-playlist", "--retries", "0", "--extractor-retries", "0", "--", `couchbandcamp:${kind}`], { timeout: 10_000 });
      assert.equal(JSON.parse(stdout).couch_bandcamp_search, body);
    }
  } finally { await plugin.close(); }
});
