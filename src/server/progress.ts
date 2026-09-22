import type { HistoryItem } from "../shared/library";
import type { PlaybackActor, PlayerState, QueueEntry } from "../shared/protocol";
import type { Store } from "./store";

export class ViewingError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

export function playbackMediaId(entry: QueueEntry): string | null {
  if (entry.live || entry.kind === "radio" || /^(radio|iptv):/.test(entry.source)) return null;
  if (/^recording:[a-f0-9-]{36}$/.test(entry.source)) return entry.source;
  if (/^library:[\w-]{1,80}$/.test(entry.source)) return entry.source;
  if (entry.source.startsWith("file:")) {
    return `file:${new Bun.CryptoHasher("sha256").update(new URL(entry.source).href).digest("hex")}`;
  }
  if (/^(web:https?:|https?:|jellyfin:)/.test(entry.source)) return `media:${new Bun.CryptoHasher("sha256").update(entry.source).digest("hex")}`;
  return null;
}

type ActiveProgress = { playbackId: string; profileId: string; item: HistoryItem; entry: QueueEntry; observed: boolean; lastSaved: string; lastWrite: number; paused: boolean; seek: { target: number; from: number } | null };

// Only native observations may change position. Commands merely request a checkpoint.
export function createProgress(store: Store, committed: () => void, now = Date.now) {
  let active: ActiveProgress | null = null;
  let pending: ActiveProgress[] = [];
  const snapshot = (progress: ActiveProgress) => JSON.stringify([progress.item.position, progress.item.duration, progress.item.watched]);
  const flush = () => {
    let saved = false;
    for (const progress of [...pending, active].filter((value): value is ActiveProgress => value !== null && value.observed)) {
      const value = snapshot(progress);
      if (value === progress.lastSaved) continue;
      store.saveProgress(progress.profileId, progress.item, progress.entry);
      progress.lastWrite = now();
      progress.lastSaved = value;
      saved = true;
    }
    pending = pending.filter(progress => snapshot(progress) !== progress.lastSaved);
    if (saved) committed();
  };
  return {
    get mediaId() { return active?.item.mediaId ?? null; },
    forgetProfile(id: string) { if (active?.profileId === id) active = null; pending = pending.filter(progress => progress.profileId !== id); },
    // Queue replacement may still fail after this checkpoint; keep observing.
    checkpoint: flush,
    begin(entry: QueueEntry, playbackId: string, profileId: string, playedBy?: PlaybackActor) {
      if (active?.observed && snapshot(active) !== active.lastSaved) pending.push(active);
      const mediaId = playbackMediaId(entry);
      active = mediaId ? {
        playbackId, profileId, entry: { ...entry }, observed: false, lastSaved: "", lastWrite: -Infinity, paused: false, seek: null,
        item: { ...(playedBy ? { playedBy: { ...playedBy } } : {}), mediaId, title: entry.title, libraryItemId: mediaId.startsWith("library:") ? mediaId.slice(8) : null, position: 0, duration: null, watched: false, lastPlayedAt: null },
      } : null;
    },
    replaceTransport(previousPlaybackId: string | null, playbackId: string, entry?: QueueEntry) {
      if (!active || active.playbackId !== previousPlaybackId) return;
      active.playbackId = playbackId;
      if (entry && playbackMediaId(entry) === active.item.mediaId) {
        active.entry = { ...entry };
        active.lastSaved = "";
      }
    },
    seek(position: number) { if (active) active.seek = { target: position, from: active.item.position }; },
    observe(player: PlayerState) {
      if (!active || player.playbackId !== active.playbackId || !["playing", "paused", "ended"].includes(player.status)) return;
      if (!Number.isFinite(player.position) || player.position < 0) return;
      const duration = player.duration !== null && Number.isFinite(player.duration) && player.duration > 0 ? player.duration : active.item.duration;
      active.item.position = active.item.mediaId.startsWith("media:") && !player.seekable ? 0 : duration === null ? player.position : Math.min(player.position, duration);
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
    finish(nearEnd = false, commit?: (save: () => void) => void) {
      const save = () => {
        if (active?.observed && nearEnd && active.item.duration !== null && active.item.duration >= 60 && active.item.position / active.item.duration >= 0.9) {
          active.item.watched = true;
          active.item.position = 0;
        }
        flush();
      };
      if (commit) {
        const previous = active && structuredClone(active);
        try { commit(save); }
        catch (error) { active = previous; throw error; }
      } else save();
      // Keep observing until all writes, including an enclosing transaction, commit.
      active = null;
    },
  };
}
