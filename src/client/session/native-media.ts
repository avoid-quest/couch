import { useEffect, useEffectEvent, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Action, PlaybackClock } from "../../shared/protocol";
import { playbackCapabilities } from "@/components/PlaybackTransport";
import { useSessionGate } from "./session-context";
import { usePlaybackClock } from "./playback-clock";
import { createId, type ClientSessionState, type Credentials } from "./session";

export type NativeMedia = {
  id: string; title: string; artist: string; album: string; playing: boolean; live: boolean;
  position: number; duration: number | null; rate: number; canPause: boolean; canSeek: boolean; canNext: boolean;
  artwork: { url: string; token?: string } | null;
};
export type NativeMediaCommand = { id: string; command: "play" | "pause" | "toggle" | "stop" | "next" | "seek"; position: number };

export function nativeMedia(state: ClientSessionState | null, connected: boolean, clock: PlaybackClock, credentials: Credentials | null, owner: string): NativeMedia | null {
  const current = state?.queue.find(entry => entry.id === state.currentEntryId);
  const player = state?.player;
  if (!connected || !credentials || !current || !player?.playbackId || !["playing", "paused", "loading"].includes(player.status)) return null;
  const programme = state?.radioProgramme?.playbackId === player.playbackId ? state.radioProgramme : null;
  const { transportReady, pausable, seekable, nextReady, hasNext } = playbackCapabilities(state, connected);
  const url = programme?.artworkUrl ?? current.thumbnail;
  const artwork = programme?.artworkUrl ? { url: programme.artworkUrl } : current.artworkId
    ? { url: `${credentials.origin}/api/library/artwork/${encodeURIComponent(current.artworkId)}`, token: credentials.token }
    : url ? { url } : null;
  const live = !!current.live || current.kind === "radio" || current.source.startsWith("radio:");
  return {
    id: `${owner}:${player.playbackId}`, title: programme?.title ?? player.nowPlaying?.title ?? current.title,
    artist: programme?.artist ?? player.nowPlaying?.artist ?? current.subtitle ?? "", album: programme?.album ?? current.collection?.title ?? "",
    playing: player.status === "playing", live, position: clock.playbackId === player.playbackId ? clock.position : 0,
    duration: live ? null : clock.playbackId === player.playbackId ? clock.duration ?? current.duration ?? null : current.duration ?? null,
    rate: player.status === "playing" && !player.buffering ? player.speed ?? 1 : 0,
    canPause: transportReady && pausable, canSeek: transportReady && seekable, canNext: nextReady && hasNext, artwork,
  };
}

export function nativeMediaAction(event: NativeMediaCommand, media: NativeMedia | null, playbackId: string | null): Action | null {
  if (!media || event.id !== media.id || !playbackId) return null;
  if (event.command === "stop") return { type: "stop", playbackId };
  if (event.command === "next") return media.canNext ? { type: "next", playbackId } : null;
  if (event.command === "seek") return media.canSeek && Number.isFinite(event.position)
    ? { type: "seek", playbackId, position: Math.max(0, Math.min(media.duration ?? Infinity, event.position)) } : null;
  if (!media.canPause) return null;
  return { type: "pause", playbackId, paused: event.command === "toggle" ? media.playing : event.command === "pause" };
}

// Preserve order even when a native host switch remounts the shell.
let publication = Promise.resolve();
function publish(media: NativeMedia | null) {
  publication = publication.then(() => invoke<void>("set_now_playing", { media })).catch(reason => console.warn("Couldn't update system media controls.", reason));
}

export function useNativeMediaSession() {
  const { nativeHost, credentials, state, connected, run } = useSessionGate();
  const clock = usePlaybackClock();
  const owner = useMemo(createId, [credentials?.origin, credentials?.token, credentials?.installationId]);
  const media = nativeHost ? nativeMedia(state, connected, clock, credentials, owner) : null;
  const serialized = JSON.stringify(media);
  const onCommand = useEffectEvent((event: NativeMediaCommand) => {
    const action = nativeMediaAction(event, media, state?.player.playbackId ?? null);
    if (action) void run(action);
  });
  useEffect(() => {
    if (!nativeHost) return;
    let disposed = false;
    const listener = listen<NativeMediaCommand>("native-media-command", event => { if (!disposed) onCommand(event.payload); });
    return () => { disposed = true; void listener.then(stop => stop()); publish(null); };
  }, [nativeHost]);
  useEffect(() => { if (nativeHost) publish(JSON.parse(serialized) as NativeMedia | null); }, [nativeHost, serialized]);
}
