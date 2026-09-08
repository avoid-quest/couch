import { useLayoutEffect, useRef, useState } from "react";
import { ChevronRight, Play, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SaveForLater } from "./SaveForLater";
import type { Action, SessionState } from "../shared/protocol";
import { AuthArtwork } from "./AuthArtwork";
import { HistoryPanel, type HistoryPlayback } from "./HistoryPanel";
import { Icon } from "./Icon";
import { PlaybackControls, sourceLabel } from "./PlaybackControls";
import { MediaArtwork } from "./ProviderPanel";
import type { Credentials } from "./session";
import "./session-home.css";

export function SessionHome({ state, credentials, connected, run, onBrowse, onPlay, active }: {
  state: SessionState | null;
  credentials: Credentials;
  connected: boolean;
  run: (action: Action) => Promise<boolean>;
  onBrowse: (section: string) => void;
  onPlay: HistoryPlayback;
  active: boolean;
}) {
  const [detailId, setDetailId] = useState<string | null>(null);
  const detailTrigger = useRef<HTMLButtonElement | null>(null);
  const hero = useRef<HTMLDivElement | null>(null);
  const queuedPlay = useRef<{ entryId: string; trigger: HTMLButtonElement } | null>(null);
  const focusedControl = useRef<HTMLElement | null>(null);
  const queue = state?.queue ?? [];
  const detail = queue.find(entry => entry.id === detailId);
  const currentIndex = queue.findIndex(entry => entry.id === state?.currentEntryId);
  const cursorIndex = currentIndex >= 0 ? currentIndex : queue.findIndex(entry => entry.id === state?.queueCursorEntryId);
  const upcoming = queue.slice(cursorIndex + 1);
  const current = queue.find(entry => entry.id === state?.currentEntryId);
  const canPlay = connected && !!state?.player && state.player.status !== "unavailable";

  useLayoutEffect(() => {
    const pending = queuedPlay.current;
    if (!pending || state?.currentEntryId !== pending.entryId) return;
    queuedPlay.current = null;
    if (active && !pending.trigger.isConnected && document.activeElement === document.body) hero.current?.querySelector<HTMLButtonElement>(".play-button:not(:disabled), .transport-buttons button:not(:disabled)")?.focus({ preventScroll: true });
  }, [state?.currentEntryId, active]);

  useLayoutEffect(() => {
    const previous = focusedControl.current;
    if (!active) { focusedControl.current = null; return; }
    if (!previous || previous.isConnected) return;
    focusedControl.current = null;
    if (document.activeElement !== document.body) return;
    const replacement = hero.current?.querySelector<HTMLButtonElement>(".session-idle-actions button, .play-button:not(:disabled)")
      ?? hero.current?.querySelector<HTMLButtonElement>(".transport-buttons button:not(:disabled), .session-remote-button");
    replacement?.focus({ preventScroll: true });
  });

  return <section className="session-home" aria-label="Current TV session">
    <div ref={hero} className="session-current" onFocusCapture={event => { focusedControl.current = event.currentTarget.contains(event.target) ? event.target : null; }} onBlurCapture={event => {
      if (event.target.isConnected && !event.currentTarget.contains(event.relatedTarget as Node | null)) focusedControl.current = null;
    }}>
      <PlaybackControls state={state} credentials={credentials} connected={connected} run={run} presentation="session" onRemote={() => onBrowse("Remote")} />
      {!current && <div className="session-idle-actions"><Button variant="ghost" className="session-remote-button" onClick={() => onBrowse("Remote")}><Icon name="remote" />Remote</Button></div>}
    </div>
    <div className="session-following">
      <section className="session-next" aria-labelledby="session-next-title">
        <div className="session-section-heading"><h2 id="session-next-title">Up next</h2><Button variant="ghost" onClick={() => onBrowse("Queue")}>{upcoming.length} waiting <ChevronRight aria-hidden="true" /></Button></div>
        {upcoming.length ? <ol className="session-next-list">{upcoming.slice(0, 3).map(entry => <li key={entry.id}>
          {entry.artworkId ? <AuthArtwork origin={credentials.origin} token={credentials.token} id={entry.artworkId} className="session-next-art" video={entry.kind !== "radio"} /> : <MediaArtwork key={entry.thumbnail || entry.id} thumbnail={entry.thumbnail} title={entry.title} className="session-next-art" />}
          <Button variant="ghost" className="session-next-copy" aria-label={`Details for ${entry.title}`} onClick={event => { detailTrigger.current = event.currentTarget; setDetailId(entry.id); }}><strong>{entry.title}</strong><small>{sourceLabel(entry.source)}{entry.live ? " · LIVE" : ""}</small></Button>
          <Button variant="secondary" size="icon" className="session-next-play" aria-label={`Play ${entry.title}`} title="Play now" disabled={!canPlay} onClick={async event => { queuedPlay.current = { entryId: entry.id, trigger: event.currentTarget }; if (!await run({ type: "play", entryId: entry.id })) queuedPlay.current = null; }}><Play aria-hidden="true" /></Button>
          <Button variant="ghost" size="icon" aria-label={`Remove ${entry.title} from Up next`} disabled={!connected} onClick={() => void run({ type: "remove", entryId: entry.id })}><X aria-hidden="true" /></Button>
        </li>)}</ol> : <p className="session-empty">Your queue is empty. Add items from Search or Saved to play them next.</p>}
        {current && <div className="session-browse-actions"><Button variant="outline" className="session-find" onClick={() => onBrowse("Search")}><Search aria-hidden="true" />Find something</Button><Button variant="ghost" className="session-find" onClick={() => onBrowse("Browse")}>Browse sources <ChevronRight aria-hidden="true" /></Button></div>}
      </section>
      <HistoryPanel presentation="inspect" key={state?.activeProfile.id} origin={credentials.origin} token={credentials.token} connected={connected} canPlay={canPlay} version={state?.libraryVersion ?? 0} onPlay={onPlay} active={active} />
    </div>
    <Dialog open={active && !!detail} onOpenChange={open => { if (!open) setDetailId(null); }}><DialogContent className="session-detail" onCloseAutoFocus={event => { event.preventDefault(); if (active && detailTrigger.current?.isConnected) detailTrigger.current.focus(); }}>
      {detail && <>
        <div className="session-detail-art">{detail.artworkId ? <AuthArtwork origin={credentials.origin} token={credentials.token} id={detail.artworkId} video={detail.kind !== "radio"} /> : <MediaArtwork key={detail.thumbnail || detail.id} thumbnail={detail.thumbnail} title={detail.title} />}</div>
        <DialogHeader><DialogTitle>{detail.title}</DialogTitle><DialogDescription>{sourceLabel(detail.source)}{detail.live ? " · LIVE" : ""} · In the TV queue</DialogDescription></DialogHeader>
        <div className="session-detail-actions"><Button disabled={!canPlay} aria-label={`Play ${detail.title} on TV`} onClick={async () => { if (await run({ type: "play", entryId: detail.id })) setDetailId(null); }}><Play aria-hidden="true" />Play on TV</Button><SaveForLater origin={credentials.origin} token={credentials.token} connected={connected} reference={{ kind: "queue", id: detail.id }} title={detail.title} /></div>
      </>}
    </DialogContent></Dialog>
  </section>;
}
