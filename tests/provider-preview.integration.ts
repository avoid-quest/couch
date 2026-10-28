import assert from "node:assert/strict";
import { test } from "node:test";
import { writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { twitchPlugin } from "../src/server/twitch";
import { streamingCommunityPlugin } from "../src/server/streamingcommunity";
import twitch from "./fixtures/twitch-extractor.py" with { type: "text" };
import streaming from "./fixtures/streamingcommunity-preview-extractor.py" with { type: "text" };

for (const [name, plugin, fixture, extractor, url, title] of [
  ["Twitch", twitchPlugin, twitch, "CouchTwitchTest", "couchtwitch:test", "Native Twitch timing retained"],
  ["StreamingCommunity", streamingCommunityPlugin, streaming, "CouchStreamingPreviewTest", "couchstreamingpreview:test", "Vixcloud literal retained"],
] as const) test(`${name} augments the real extractor without extra preview network work`, { skip: !process.env.COUCH_TEST_YT_DLP }, async () => {
  const bundled = await plugin();
  try {
    await writeFile(join(bundled.directory, "bundled", "yt_dlp_plugins", "extractor", "offline.py"), fixture);
    const { stdout } = await promisify(execFile)(process.env.COUCH_TEST_YT_DLP!, ["--ignore-config", "--no-cache-dir", "--no-plugin-dirs", "--plugin-dirs", bundled.directory,
      "--use-extractors", `${extractor},end`, "--skip-download", "--dump-single-json", "--", url], { timeout: 10_000 });
    assert.equal(JSON.parse(stdout).title, title);
  } finally { await bundled.close(); }
  await assert.rejects(stat(bundled.directory), { code: "ENOENT" });
});
