import { Pause, Play, SkipForward, Square } from "lucide-react";
import { useLayoutEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import type { Action, SessionState } from "../shared/protocol";
import type { Credentials } from "./session";
import { AuthArtwork } from "./AuthArtwork";
import { MediaArtwork } from "./ProviderPanel";

export function SessionBar({ state, credentials, connected, run, onOpen }: {
  state: SessionState | null; credentials: Credentials; connected: boolean;
  run: (action: Action) => Promise<boolean>; onOpen: () => void;
}) {
  const bar = useRef<HTMLElement | null>(null);
  const focusedControl = useRef<HTMLElement | null>(null);
  const restorePageFocus = (previous: HTMLElement) => requestAnimationFrame(() => {
    if (document.activeElement !== document.body && document.activeElement !== previous) return;
    const target = [...document.querySelectorAll<HTMLElement>('.primary-nav [aria-current="page"], [data-page]:not([hidden]) h1')]
      .find(element => !element.closest('[hidden], [inert], [aria-hidden="true"]'));
    if (target) {
      if (target.matches("h1")) target.tabIndex = -1;
      target.focus({ preventScroll: true });
    }
  });
  useLayoutEffect(() => {
    const previous = focusedControl.current;
    if (!previous || previous.isConnected && !previous.matches(":disabled")) return;
    if (document.activeElement !== document.body && document.activeElement !== previous) return;
    focusedControl.current = null;
    const replacement = bar.current?.querySelector<HTMLElement>(".session-bar-controls button:not(:disabled)")
      ?? bar.current?.querySelector<HTMLElement>(".session-bar-open");
    if (replacement) replacement.focus({ preventScroll: true });
    else restorePageFocus(previous);
  });
  useLayoutEffect(() => () => {
    const previous = focusedControl.current;
    if (previous && (document.activeElement === previous || document.activeElement === document.body)) restorePageFocus(previous);
  }, []);
  const player = state?.player;
  const current = state?.queue.find(entry => entry.id === state.currentEntryId);
  if (!current || !player?.playbackId) return null;
  const ready = connected && ["playing", "paused"].includes(player.status);
  const active = connected && ["loading", "playing", "paused"].includes(player.status);
  const currentIndex = state!.queue.findIndex(entry => entry.id === current.id);
  const hasNext = currentIndex < state!.queue.length - 1;
  return <footer ref={bar} className="session-bar" aria-label="Current TV playback" onFocusCapture={event => { focusedControl.current = event.target; }} onBlurCapture={event => {
    if (event.target.isConnected && !event.target.matches(":disabled") && !event.currentTarget.contains(event.relatedTarget as Node | null)) focusedControl.current = null;
  }}>
    <button className="session-bar-open" onClick={onOpen} aria-label={`Open current playback: ${current.title}`}>
      <span className="session-bar-art" aria-hidden="true">{current.artworkId ? <AuthArtwork origin={credentials.origin} token={credentials.token} id={current.artworkId} /> : current.thumbnail ? <MediaArtwork thumbnail={current.thumbnail} title={current.title} /> : <Play />}</span>
      <span><small>{state?.installationName || "Your TV"} · {player.status === "playing" ? "Playing" : player.status === "paused" ? "Paused" : player.status === "loading" ? "Loading" : player.status === "error" ? "Playback error" : player.status === "ended" ? "Finished" : "Offline"}</small><strong>{current.title}</strong></span>
    </button>
    <div className="session-bar-controls" role="group" aria-label="Playback controls">
      <Button variant="ghost" size="icon" disabled={!ready} aria-label={player.status === "playing" ? "Pause playback" : "Resume playback"} title={player.status === "playing" ? "Pause" : "Resume"} onClick={() => void run({ type: "pause", playbackId: player.playbackId!, paused: player.status === "playing" })}>{player.status === "playing" ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}</Button>
      {hasNext && <Button variant="ghost" size="icon" disabled={!ready} aria-label="Next in queue" title="Next in queue" onClick={() => void run({ type: "next", playbackId: player.playbackId! })}><SkipForward aria-hidden="true" /></Button>}
      <Button variant="ghost" size="icon" disabled={!active} aria-label="Stop playback" title="Stop playback" onClick={() => void run({ type: "stop" })}><Square aria-hidden="true" /></Button>
    </div>
  </footer>;
}
