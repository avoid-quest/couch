import { expect, test } from "bun:test";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { streamingCommunityPlugin } from "./streamingcommunity";

test("materializes only the pinned extractor source behind a private directory", async () => {
  const plugin = await streamingCommunityPlugin();
  try {
    expect((await stat(plugin.directory)).mode & 0o777).toBe(0o700);
    expect(await readdir(plugin.directory)).toEqual(["bundled"]);
    const path = join(plugin.directory, "bundled", "yt_dlp_plugins", "extractor", "streamingcommunity.py");
    const source = await Bun.file(path).arrayBuffer();
    expect(new Bun.CryptoHasher("sha256").update(source).digest("hex")).toBe("ac4ed1a6038e4d332b364ad3c8708ac1615248eba12f4313bebfbdd9c4b87be7");
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  } finally { await plugin.close(); }
});
