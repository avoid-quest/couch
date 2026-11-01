import assert from "node:assert/strict";
import { test } from "node:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { soundCloudPlugin } from "../src/server/soundcloud";
import fixture from "./fixtures/soundcloud-extractor.py" with { type: "text" };

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
