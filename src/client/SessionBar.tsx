import { Play } from "lucide-react";
import { useLayoutEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import type { Action, SessionState } from "../shared/protocol";
import type { Credentials } from "./session";
import { AuthArtwork } from "./AuthArtwork";
import { MediaArtwork } from "./ProviderPanel";
import { Icon } from "./Icon";
import { PlaybackTransport, PlaybackVolume } from "./PlaybackTransport";
import "./session-bar.css";

export function SessionBar({ state, credentials, connected, run, onOpen, onRemote }: {
  state: SessionState | null; credentials: Credentials; connected: boolean;
  run: (action: Action) => Promise<boolean>; onOpen: () => void; onRemote?: () => void;
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
    const replacement = bar.current?.querySelector<HTMLElement>('.session-bar-controls .play-button:not(:disabled), .session-bar-controls .transport-stop:not(:disabled)')
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
  return <footer ref={bar} className="session-bar" aria-label="Current TV playback" onFocusCapture={event => { focusedControl.current = event.target; }} onBlurCapture={event => {
    if (event.target.isConnected && !event.target.matches(":disabled") && !event.currentTarget.contains(event.relatedTarget as Node | null)) focusedControl.current = null;
  }}>
    <button className="session-bar-open" onClick={onOpen} aria-label={`Open current playback: ${current.title}`}>
      <span className="session-bar-art" aria-hidden="true">{current.artworkId ? <AuthArtwork origin={credentials.origin} token={credentials.token} id={current.artworkId} /> : current.thumbnail ? <MediaArtwork thumbnail={current.thumbnail} title={current.title} /> : <Play />}</span>
      <span><small>{state?.installationName || "Your TV"} · {player.status === "playing" ? "Playing" : player.status === "paused" ? "Paused" : player.status === "loading" ? "Loading" : player.status === "error" ? "Playback error" : player.status === "ended" ? "Finished" : "Offline"}</small><strong>{current.title}</strong></span>
    </button>
    <PlaybackTransport state={state!} credentials={credentials} connected={connected} run={run} compact />
    <div className="session-bar-volume">
      <PlaybackVolume state={state!} connected={connected} run={run} />
      {onRemote && <Button variant="ghost" size="icon" className="session-bar-remote" aria-label="Remote" title="Remote" onClick={onRemote}><Icon name="remote" /></Button>}
    </div>
  </footer>;
}
