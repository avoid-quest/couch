import assert from "node:assert/strict";
import { test } from "node:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { raiPlayPreviewPlugin } from "../src/server/raiplay-preview";
import fixture from "./fixtures/raiplay-extractor.py" with { type: "text" };

// Exercise the real managed yt-dlp, with its upstream XML transport stubbed.
test("RaiPlay retains timed previews from the existing relinker fetch and resets them between items", { skip: !process.env.COUCH_TEST_YT_DLP }, async () => {
  const plugin = await raiPlayPreviewPlugin();
  try {
    await writeFile(join(plugin.directory, "bundled", "yt_dlp_plugins", "extractor", "offline.py"), fixture);
    const { stdout } = await promisify(execFile)(process.env.COUCH_TEST_YT_DLP!, ["--ignore-config", "--no-cache-dir", "--no-plugin-dirs", "--plugin-dirs", plugin.directory,
      "--use-extractors", "CouchRaiPlayTest,end", "--skip-download", "--dump-single-json", "--", "couchraiplay:test"], { timeout: 10_000 });
    assert.equal(JSON.parse(stdout).title, "RaiPlay preview retention checks passed");
  } finally { await plugin.close(); }
});
