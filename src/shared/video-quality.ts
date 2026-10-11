import { audioExtensions } from "./media";
import type { PlayerState, QueueEntry } from "./protocol";

export function supportsWebVideoQuality(source: string) {
  try {
    const url = new URL(source.trim());
    const extension = decodeURIComponent(url.pathname).split(".").at(-1)!.toLowerCase();
    return !["bandcamp.com", "soundcloud.com"].some(host => url.hostname === host || url.hostname.endsWith(`.${host}`)) && !audioExtensions.has(extension) && !["oga", "mka"].includes(extension);
  } catch { return true; }
}

export function supportsCurrentVideoQuality(entry: QueueEntry | undefined, player: Pick<PlayerState, "playbackId" | "status" | "seekable" | "tracks">) {
  return !!entry && entry.source.startsWith("web:") && entry.kind !== "radio"
    && supportsWebVideoQuality(entry.source.slice(4)) && !!player.playbackId
    && ["playing", "paused"].includes(player.status) && (entry.live === true || player.seekable)
    && (!player.tracks?.length || player.tracks.some(track => track.kind === "video"));
}
