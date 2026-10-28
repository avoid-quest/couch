import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import extractor from "../../vendor/twitch/twitch.py" with { type: "text" };

export async function twitchPlugin() {
  const directory = await mkdtemp(join(tmpdir(), "couch-twitch-"));
  try {
    const target = join(directory, "bundled", "yt_dlp_plugins", "extractor");
    await mkdir(target, { recursive: true, mode: 0o700 });
    await writeFile(join(target, "twitch.py"), extractor, { mode: 0o600 });
    return { directory, close: () => rm(directory, { recursive: true, force: true }) };
  } catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
}
