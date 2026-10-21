import type { ClientSessionState } from "./session/session";
import { deviceName } from "./copy";

/**
 * One vocabulary for the player, its compact bar, Home and Up next. `quiet` marks the plain states (Playing, Paused,
 * Ready to play) that the Play/Pause glyph already says, so status lines show only what the transport can't.
 */
export function playbackStatus(state: ClientSessionState | null | undefined, connected: boolean, now = Date.now()) {
  // The label says Offline; its detail says only what happens next.
  if (!connected) return { label: "Offline", detail: `Reconnecting to ${deviceName(state?.installationName)}…`, busy: true };
  const player = state?.player;
  if (!player) return { label: "Connecting…", detail: "Waiting for playback information.", busy: true };
  if (player.status === "unavailable") return { label: "Player unavailable", detail: player.error || "Check the playing device's connection, or choose another device in Where it plays.", busy: false };
  if (player.status === "error") return { label: "Can't play", detail: player.error || "Try again, or choose another item.", busy: false };
  if (player.status === "loading") {
    const retry = state?.radioRetry;
    if (retry?.retryAt != null) return { label: "Reconnecting…", detail: `Trying again in ${Math.max(0, Math.ceil((retry.retryAt - now) / 1000))} s (${retry.attempt} of ${retry.maximum}).`, busy: true };
    return { label: player.buffering ? "Buffering…" : "Loading…", detail: "", busy: true };
  }
  if (player.status === "ended") return state?.autoplay?.enabled && state.autoplay.pending
    ? { label: "Finding the next item…", detail: "", busy: true }
    : { label: "Finished", detail: "Replay to play it again.", busy: false };
  return { label: player.status === "paused" ? "Paused" : player.status === "playing" ? "Playing" : "Ready to play", detail: "", busy: false, quiet: true };
}

/**
 * Whether sound is coming out of the looked-at Playback, which moves the level (Level.tsx): only while it plays. Paused,
 * buffering, loading or offline, it lies flat. It says what the player reports, not how loud the sound is.
 */
export const sounding = (state: ClientSessionState | null | undefined, connected: boolean) =>
  connected && state?.player?.status === "playing" && !state.player.buffering;

/** The address an item and a queue entry share: a page's URL, without the `web:` a pasted link carries. */
const address = (source: string) => source.replace(/^web:/, "");

/**
 * The level an item in a list shows, by its addresses (a page's URL; a station's `radio:{id}` and stream URL): none
 * unless it is what the looked-at Playback plays, else moving or flat.
 */
export function levelOf(state: ClientSessionState | null | undefined, connected: boolean, sources: readonly (string | undefined)[]) {
  const current = state?.queue?.find(entry => entry.id === state.currentEntryId);
  if (!current || !sources.some(source => source && address(source) === address(current.source))) return null;
  return sounding(state, connected) ? "moving" : "flat";
}
