import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import extractor from "../../vendor/streamingcommunity/streamingcommunity.py" with { type: "text" };
import { streamingCommunityOrigin, validStreamingCommunityOrigin } from "../shared/streamingcommunity";

export function streamingCommunityLink(source: string, origin = streamingCommunityOrigin): boolean {
  const url = new URL(source);
  if (!validStreamingCommunityOrigin(origin)) throw new Error("StreamingCommunity needs a valid website origin in Settings > Sources.");
  if (url.origin !== origin) {
    if (/stream\w*unity/i.test(url.hostname)) throw new Error("This StreamingCommunity website is unavailable. Ask an administrator to update its origin in Settings > Sources, then paste a new item link. Saved links are not retargeted.");
    return false;
  }
  if (url.username || url.password || url.hash || !/^\/(?:[a-z]{2}\/)?(?:watch\/\d+|titles\/\d+(?:-[\w-]+)?)$/.test(url.pathname) || (url.search && !/^\?e=\d+$/.test(url.search))) throw new Error("Paste a StreamingCommunity film or episode link. Browsing, series and season links are not supported.");
  return true;
}

// Embedded in the signed sidecar; the only directory this extraction can load.
export async function streamingCommunityPlugin() {
  const directory = await mkdtemp(join(tmpdir(), "couch-streamingcommunity-"));
  try {
    const target = join(directory, "bundled", "yt_dlp_plugins", "extractor");
    await mkdir(target, { recursive: true, mode: 0o700 });
    await writeFile(join(target, "streamingcommunity.py"), extractor, { mode: 0o600 });
    return { directory, close: () => rm(directory, { recursive: true, force: true }) };
  } catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
}
