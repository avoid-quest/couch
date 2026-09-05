import type { HistoryItem } from "../shared/library";
import type { PlayerState, QueueEntry } from "../shared/protocol";
import type { Store } from "./store";

export class ViewingError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

export function localMediaId(entry: QueueEntry): string | null {
  if (entry.live) return null;
  if (/^library:[\w-]{1,80}$/.test(entry.source)) return entry.source;
  if (entry.source.startsWith("file:")) {
    return `file:${new Bun.CryptoHasher("sha256").update(new URL(entry.source).href).digest("hex")}`;
  }
  return null;
}

type ActiveProgress = { playbackId: string; profileId: string; item: HistoryItem; observed: boolean; lastSaved: string; lastWrite: number; paused: boolean; seek: { target: number; from: number } | null };

// Only native observations may change position. Commands merely request a checkpoint.
export function createProgress(store: Store, committed: () => void, now = Date.now) {
  let active: ActiveProgress | null = null;
  const flush = () => {
    if (!active?.observed) return;
    const snapshot = JSON.stringify([active.item.position, active.item.duration, active.item.watched]);
    if (snapshot === active.lastSaved) return;
    store.saveProgress(active.profileId, active.item);
    active.lastWrite = now();
    active.lastSaved = snapshot;
    committed();
  };
  return {
    get mediaId() { return active?.item.mediaId ?? null; },
    // Queue replacement may still fail after this checkpoint; keep observing.
    checkpoint: flush,
    begin(entry: QueueEntry, playbackId: string, profileId: string) {
      const mediaId = localMediaId(entry);
      active = mediaId ? {
        playbackId, profileId, observed: false, lastSaved: "", lastWrite: -Infinity, paused: false, seek: null,
        item: { mediaId, title: entry.title, libraryItemId: mediaId.startsWith("library:") ? mediaId.slice(8) : null, position: 0, duration: null, watched: false, lastPlayedAt: null },
      } : null;
    },
    seek(position: number) { if (active) active.seek = { target: position, from: active.item.position }; },
    observe(player: PlayerState) {
      if (!active || player.playbackId !== active.playbackId || !["playing", "paused", "ended"].includes(player.status)) return;
      if (!Number.isFinite(player.position) || player.position < 0) return;
      const duration = player.duration !== null && Number.isFinite(player.duration) && player.duration > 0 ? player.duration : active.item.duration;
      active.item.position = duration === null ? player.position : Math.min(player.position, duration);
      active.item.duration = duration;
      active.item.lastPlayedAt = now();
      active.observed = true;
      const paused = player.status === "paused";
      const seekAcknowledged = active.seek !== null && Math.abs(player.position - active.seek.target) <= 2
        && (active.seek.target < active.seek.from ? player.position < active.seek.from : active.seek.target > active.seek.from ? player.position > active.seek.from : true);
      const checkpoint = paused !== active.paused || seekAcknowledged || now() - active.lastWrite >= 10_000;
      active.paused = paused;
      if (seekAcknowledged) active.seek = null;
      if (player.status === "ended") { active.item.watched = true; active.item.position = 0; flush(); active = null; }
      else if (checkpoint) flush();
    },
    finish(nearEnd = false) {
      if (active?.observed && nearEnd && active.item.duration !== null && active.item.duration >= 60 && active.item.position / active.item.duration >= 0.9) {
        active.item.watched = true;
        active.item.position = 0;
      }
      // Keep the observation on a failed write so a later stop/play can retry it.
      flush();
      active = null;
    },
  };
}
