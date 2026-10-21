import type { ClientSessionState } from "./session/session";
import { offline } from "./copy";

/**
 * One vocabulary for the player, its compact bar, Home and Up next. `quiet` marks the plain states (Playing, Paused,
 * Ready to play) that the Play/Pause glyph already says, so status lines show only what the transport can't.
 */
export function playbackStatus(state: ClientSessionState | null | undefined, connected: boolean, now = Date.now()) {
  if (!connected) return { label: "Offline", detail: offline(state?.installationName), busy: true };
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
