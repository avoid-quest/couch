import { Play } from "lucide-react";
import { useLayoutEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Action, SessionState } from "../shared/protocol";
import type { Credentials } from "./session/session";
import { AuthArtwork } from "./AuthArtwork";
import { MediaArtwork } from "./ProviderPanel";
import { Icon } from "./Icon";
import { playbackCapabilities, PlaybackTimeline, PlaybackTransport, PlaybackVolume } from "./PlaybackTransport";
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
  const radio = current?.kind === "radio" || current?.source.startsWith("radio:");
  const programme = connected && radio && state?.radioProgramme?.playbackId === player?.playbackId ? state?.radioProgramme : null;
  const artwork = programme?.artworkUrl || current?.thumbnail;
  if (!current || !player || !playbackCapabilities(state, connected).active && player.status !== "error") return null;
  return <footer ref={bar} className="session-bar" aria-label="Current playback" onFocusCapture={event => {
    // Dialogs and selects bubble through React portals but own their focus recovery.
    focusedControl.current = event.currentTarget.contains(event.target) ? event.target : null;
  }} onBlurCapture={event => {
    if (!event.currentTarget.contains(event.target)) return;
    if (event.target.isConnected && !event.target.matches(":disabled") && !event.currentTarget.contains(event.relatedTarget as Node | null)) focusedControl.current = null;
  }}>
    <button className="session-bar-open" onClick={onOpen} aria-label={`Open Now playing: ${current.title}`}>
      <span className="session-bar-art" aria-hidden="true">{current.artworkId ? <AuthArtwork origin={credentials.origin} token={credentials.token} id={current.artworkId} /> : artwork ? <MediaArtwork key={artwork} thumbnail={artwork} title={programme?.title || current.title} /> : <Play />}</span>
      <span><small>{!connected ? "Reconnecting" : player.status === "error" ? "Playback error" : player.status === "paused" ? "Paused" : player.status === "loading" ? state?.radioRetry ? "Reconnecting" : "Loading" : current.live || radio ? "Live" : "Playing"}{state?.installationName && ` · ${state.installationName}`}</small><strong>{current.title}</strong>{programme && <small className="session-bar-programme">{programme.title}</small>}</span>
    </button>
    <div className="session-bar-transport">
      <PlaybackTransport state={state!} credentials={credentials} connected={connected} run={run} compact />
      <PlaybackTimeline state={state!} connected={connected} run={run} />
    </div>
    <div className="session-bar-volume">
      <PlaybackVolume state={state!} connected={connected} run={run} />
      {onRemote && <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" className="session-bar-remote" aria-label="Remote" onClick={onRemote}><Icon name="remote" /></Button></TooltipTrigger><TooltipContent>Remote</TooltipContent></Tooltip>}
    </div>
  </footer>;
}
