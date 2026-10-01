import { useCouchHotkeys } from "@/useCouchHotkeys";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ArrowLeft, Captions, ChevronRight, Info, ListMusic, Maximize, Minimize, Music2, Settings, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { MediaArtwork } from "@/components/MediaArtwork";
import { PlaybackTimeline, PlaybackTransport, VolumeButton, playbackCapabilities } from "@/components/PlaybackTransport";
import { sourceLabel } from "@/source-label";
import { PlaybackSettingsPanel } from "@/components/PlaybackSettings";
import { deviceName, offline } from "@/copy";
import { useBottomBar } from "@/sections/shell/MiniPlayer";
import { QueuePanel } from "./QueuePanel";
import { usePlayerFullscreen } from "./usePlayerFullscreen";
import { useShell } from "@/sections/shell/AppShell";
import { useSessionGate } from "@/session/session-context";
import { renderInto } from "@/session/renderer";
import { playsOn, showsPicture } from "@/session/device-id";
import { PlaysOn, WhereItPlays } from "@/sections/shell/Outputs";
import { CouchSwitch } from "@/sections/shell/CouchSwitch";
import { cn } from "@/lib/utils";
import { Link } from "@tanstack/react-router";
import { ContentBreadcrumb } from "@/components/ContentBreadcrumb";
import { providerForUrl } from "../../../shared/providers";
import { queueItemLocation } from "@/detail-navigation";

type Panel = "tracks" | "settings";
const panelTitles: Record<Panel, string> = { tracks: "Audio & subtitles", settings: "Playback" };
// From 960px audio keeps Up next on screen beside the artwork (index.css), so the band's Up next has nothing to open.
const wideQuery = "(min-width: 960px)";
const subscribeWide = (onChange: () => void) => { const media = window.matchMedia(wideQuery); media.addEventListener("change", onChange); return () => media.removeEventListener("change", onChange); };
const isWide = () => window.matchMedia(wideQuery).matches;

export function PlayerPage({ queueOpen: requestedQueueOpen, onQueueOpenChange }: { queueOpen?: boolean; onQueueOpenChange?: (open: boolean) => void } = {}) {
  const fullscreen = usePlayerFullscreen();
  useCouchHotkeys([{ hotkey: "F", enabled: fullscreen.supported && !fullscreen.pending, action: () => void fullscreen.toggle() }]);
  const shell = useShell();
  const { credentials, available, active, current, programme } = shell;
  const { state, connected, run, nativeHost, tvPresentation, videoQualityPreference } = useSessionGate();
  const [panelState, setPanelState] = useState<{ playbackId: string; panel: Panel } | null>(null);
  const [shown, setShown] = useState(true);
  const [localQueueOpen, setLocalQueueOpen] = useState(false);
  const queueOpen = requestedQueueOpen ?? localQueueOpen;
  const setQueueOpen = useCallback((open: boolean) => { if (onQueueOpenChange) onQueueOpenChange(open); else setLocalQueueOpen(open); }, [onQueueOpenChange]);
  const queueTrigger = useRef<HTMLButtonElement>(null);
  const queueClose = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const root = useRef<HTMLElement>(null);
  const closeQueue = useCallback(() => {
    setQueueOpen(false);
    (queueTrigger.current?.getClientRects().length ? queueTrigger.current : root.current?.querySelector<HTMLButtonElement>('button[data-play-button]:not(:disabled), button[data-primary]:not(:disabled)') ?? root.current?.querySelector<HTMLElement>('[aria-label="Content path"] a'))?.focus();
  }, [setQueueOpen]);
  const band = useRef<HTMLDivElement>(null);
  const panelTrigger = useRef<HTMLButtonElement>(null);
  const panelClose = useRef<HTMLButtonElement>(null);
  const [now, setNow] = useState(Date.now());
  const player = state?.player;
  const panel = current && active && panelState?.playbackId === player?.playbackId ? panelState?.panel ?? null : null;
  const playing = player?.status === "playing";
  const ended = player?.status === "ended";
  const findingNext = ended && state?.autoplay?.enabled && state.autoplay.pending;
  const audioOnly = current?.kind === "radio" || !!current?.source.startsWith("radio:") || !!player?.tracks?.some(track => track.kind === "audio") && !player.tracks.some(track => track.kind === "video" && track.selected);
  // The picture shows on the Playback's picture outputs; every other window shows the artwork (#644 ticket 9).
  const at = playsOn(state);
  const elsewhere = !!at?.elsewhere;
  // An mpv channel shows its picture in mpv's own window, so this one shows the artwork.
  const separate = !!state?.playbacks?.find(playback => playback.id === state.playback)?.hostOnly && showsPicture(state);
  const picture = showsPicture(state) && !separate;
  const artworkStage = audioOnly || !picture;
  const queueBeside = useSyncExternalStore(subscribeWide, isWide) && artworkStage;
  const autoHide = playing && !artworkStage;
  useBottomBar(band, !!current && shown);
  useEffect(() => { setPanelState(null); }, [active, player?.playbackId]);
  useEffect(() => { if (panel) panelClose.current?.focus(); }, [panel]);
  useEffect(() => { if (queueOpen) (queueClose.current ?? root.current?.querySelector<HTMLElement>('[aria-label="Content path"] a'))?.focus(); }, [queueOpen]);
  const { transportReady, pausable } = playbackCapabilities(state, connected);
  const name = deviceName(state?.installationName);
  const currentIndex = state?.queue.findIndex(entry => entry.id === state.currentEntryId) ?? -1;
  const following = currentIndex >= 0 ? state?.queue[currentIndex + 1] ?? (state?.autoplay?.enabled ? state.autoplay.next : undefined) : undefined;
  const retry = state?.radioRetry?.retryAt != null && player?.status === "loading" ? state.radioRetry : null;
  const retrySeconds = retry ? Math.max(0, Math.ceil((retry.retryAt! - now) / 1000)) : 0;
  const wake = () => {
    setShown(true);
    clearTimeout(timer.current);
    if (autoHide && !panel && !queueOpen) timer.current = setTimeout(() => { if (!root.current?.querySelector(":focus-visible")) setShown(false); }, 4000);
  };
  useEffect(() => {
    clearTimeout(timer.current);
    if (!autoHide || panel || queueOpen) setShown(true);
    else timer.current = setTimeout(() => { if (!root.current?.querySelector(":focus-visible")) setShown(false); }, 4000);
    return () => clearTimeout(timer.current);
  }, [autoHide, panel, queueOpen]);
  useEffect(() => {
    if (!nativeHost || !current || shown) return;
    document.documentElement.toggleAttribute("data-cursor-hidden", true);
    return () => { document.documentElement.toggleAttribute("data-cursor-hidden", false); };
  }, [nativeHost, !!current, shown]);
  useEffect(() => {
    if (!retry) return;
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [retry?.retryAt]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === "Escape" || event.key === "BrowserBack") {
        if (document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="listbox"][data-state="open"], [role="menu"][data-state="open"], [data-slot="popover-content"][data-state="open"]')) return;
        event.preventDefault(); event.stopImmediatePropagation();
        if (panel) setPanelState(null);
        else if (queueOpen) closeQueue();
        else if (event.key === "Escape" && fullscreen.supported && fullscreen.fullscreen) void fullscreen.toggle();
        else shell.leavePlayer();
        return;
      }
      const inPlayer = root.current?.contains(document.activeElement) || document.activeElement === document.body;
      if (!panel && !shown && inPlayer && (tvPresentation ? ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter", " "] : ["Enter"]).includes(event.key)) {
        event.preventDefault(); event.stopImmediatePropagation(); wake();
        requestAnimationFrame(() => (root.current?.querySelector<HTMLElement>('[role="slider"][aria-label="Playback position"]:not([data-disabled])') ?? root.current?.querySelector<HTMLElement>('[data-play-button]:not(:disabled), [data-primary]:not(:disabled)'))?.focus());
        return;
      }
      if (tvPresentation && !panel && event.key === " " && inPlayer && !(event.target instanceof HTMLElement && event.target.closest('button, a, input, select, textarea, [role="slider"]')) && transportReady && pausable && player?.playbackId) {
        event.preventDefault(); void run({ type: "pause", playbackId: player.playbackId, paused: playing });
      }
      if (inPlayer) wake();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [tvPresentation, shown, panel, queueOpen, closeQueue, playing, autoHide, transportReady, pausable, player?.playbackId, run, shell.leavePlayer, fullscreen]);
  // An explicitly opened queue remains available after playback stops.
  if (!current && !queueOpen) return null;

  const buffering = player?.status === "loading" && player.buffering;
  const currentProgramme = programme?.playbackId === player?.playbackId ? programme : null;
  const provider = current && providerForUrl(current.source.replace(/^web:/, ""));
  const radio = current?.kind === "radio" || current?.source.startsWith("radio:");
  const detailHref = current ? queueItemLocation(current) : undefined;
  const details = detailHref && <Button asChild variant="ghost" size="icon" className="size-11" aria-label="Details" title="Details"><Link to={detailHref}><Info aria-hidden="true" /></Link></Button>;
  const artwork = currentProgramme?.artworkUrl ? <MediaArtwork thumbnail={currentProgramme.artworkUrl} title={currentProgramme.title} /> : current?.thumbnail ? <MediaArtwork thumbnail={current.thumbnail} title={current.title} /> : undefined;
  const openPanel = (value: Panel, trigger: HTMLButtonElement) => { if (!player?.playbackId) return; panelTrigger.current = trigger; setPanelState({ playbackId: player.playbackId, panel: value }); setShown(true); };
  const source = current ? sourceLabel(current.source) : "";
  const nowPlaying = player?.nowPlaying && [player.nowPlaying.artist, player.nowPlaying.title].filter(Boolean).join(" — ");
  const unavailable = connected && player?.status === "unavailable";
  const errorDetail = current?.kind === "radio" || current?.source.startsWith("radio:") ? "The station stopped sending audio." : current?.live ? "This stream has ended." : "This video is unavailable.";
  const skip = () => void run(player?.playbackId ? { type: "next", playbackId: player.playbackId } : following ? { type: "play", entryId: following.id } : { type: "stop" });
  const status = !current ? null : unavailable ? { title: player?.error ?? `Nothing is playing on ${name}`, detail: "Press Play to start it again here." }
    : player?.status === "error" ? { title: `Can't play ${current.title}`, detail: player.error || errorDetail }
    : retry ? { title: `Reconnecting to ${current.title}`, detail: `Retrying in ${retrySeconds} s (${retry.attempt} of ${retry.maximum})`, busy: true }
    : player?.status === "loading" && !player.buffering ? { title: `Loading ${current.title}`, detail: `Connecting to ${source}…`, busy: true }
    : ended && !artworkStage ? { title: findingNext ? "Finding the next item…" : `Finished ${current.title}`, detail: findingNext ? "" : "Replay to watch again.", busy: !!findingNext }
    : null;

  return <section ref={root} className={cn("player-page fixed inset-0 overflow-hidden bg-background", !shown && "cursor-none [&_*]:cursor-none")} data-page="Now" data-artwork-stage={artworkStage || undefined} data-queue-open={queueOpen || undefined} data-player-idle={!current || undefined} aria-label="Player" onPointerMove={wake} onPointerLeave={() => { setShown(true); clearTimeout(timer.current); }} onFocus={wake} onBlur={wake}>
    <div ref={picture ? renderInto : undefined} className="player-video absolute inset-0" onClick={() => { if (!shown) { wake(); return; } if (!audioOnly && active && player?.playbackId && transportReady && pausable) void run({ type: "pause", playbackId: player.playbackId, paused: playing }); }}>
    </div>
    {/* Same height and gutter as the app header, with its Couch switch. */}
    <div data-player-header inert={!shown} className={cn("player-header drag-region window-controls-inset absolute inset-x-0 top-0 z-20 flex h-14 items-center gap-3 px-(--gutter) transition-opacity duration-200 motion-reduce:transition-none", !shown && "opacity-0 pointer-events-none")}>
      <div className="min-w-0 bg-background [&_ol]:flex-nowrap"><ContentBreadcrumb title={current?.title ?? "Player"} provider={provider} collection={current?.collection} radio={!!radio} /></div>
      {buffering && <p role="status" className="flex min-w-0 items-center gap-2 bg-background px-2 py-1 text-sm"><Spinner role="presentation" aria-label={undefined} aria-hidden="true" />Buffering…</p>}
      <div className="ml-auto flex shrink-0 bg-background"><CouchSwitch credentials={credentials} connected={connected} status={shell.statusLabel} installationName={state?.installationName} /></div>
    </div>
    <div className="player-workspace">
      <div className="player-main">
      {current && (!picture || (active || ended) && audioOnly) && !status && <div data-player-summary className="player-summary">
        <div data-player-art aria-hidden="true" className="player-art grid min-h-0 min-w-0 place-items-center overflow-hidden">{artwork || <Music2 className="size-12 text-muted-foreground" />}</div>
        <div data-player-audio-copy className="grid min-w-0 max-w-xl gap-2 text-center">
          <div className="flex min-w-0 items-center justify-center gap-1">
            <h1 className="min-w-0 line-clamp-2 text-2xl font-medium tracking-tight break-words" title={currentProgramme?.title || current.title}>{currentProgramme?.title || current.title}</h1>
            {details}
          </div>
          {ended && <p role="status" className="text-sm text-muted-foreground">{findingNext ? "Finding the next item…" : "Finished"}</p>}
          {current.subtitle && !currentProgramme && <p className="truncate text-sm text-muted-foreground">{current.subtitle}</p>}
          <p className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-sm text-muted-foreground">{!ended && player?.status === "paused" && <span>Paused</span>}{!ended && (elsewhere && at ? <PlaysOn at={at} /> : separate && ["playing", "paused"].includes(player?.status ?? "") ? <span>{player?.status === "paused" ? "in a separate window" : "Playing in a separate window"}</span> : currentProgramme && <span>{current.title}</span>)}</p>
          {nowPlaying && <p role="status" className="line-clamp-1 text-sm text-muted-foreground">{nowPlaying}</p>}
          {!connected && <p className="line-clamp-2 text-sm text-muted-foreground">{offline(name)}</p>}
        </div>
      </div>}
    {current && status && <div data-player-status className={cn("pointer-events-none absolute inset-0 z-10 grid place-items-center px-(--gutter)", !artworkStage && "pb-48")}>
      <div role="status" className="pointer-events-auto grid max-h-full max-w-lg gap-2 overflow-y-auto bg-background p-6">
        <h2 className="text-2xl font-semibold tracking-tight break-words">{status.title}</h2>
        <p className="flex items-center gap-2 text-sm text-muted-foreground">{status.busy && <Spinner role="presentation" aria-label={undefined} aria-hidden="true" />}{status.detail}</p>
        {(retry || player?.status === "error") && <div className="mt-4 flex flex-wrap gap-2">
          <Button disabled={!available} onClick={() => void run({ type: "play", entryId: current.id })}>{retry ? "Try now" : "Try again"}</Button>
          <Button variant="ghost" disabled={!available} onClick={skip}>Skip</Button>
          {player?.status === "error" && <Button variant="ghost" onClick={shell.leavePlayer}>{shell.playerBackLabel || "Find"}</Button>}
        </div>}
      </div>
    </div>}
      </div>
      {(artworkStage || queueOpen) && <aside data-player-queue aria-label="Up next" className="player-queue bg-background">
        {queueOpen && current && <div className="flex shrink-0 justify-end pb-2"><Button ref={queueClose} variant="ghost" className="h-11" onClick={closeQueue}><ArrowLeft aria-hidden="true" />Back to player</Button></div>}
        <div className="min-h-0 overflow-y-auto overscroll-contain pb-4">
          <QueuePanel state={state} credentials={credentials} connected={connected} available={available} nativeHost={nativeHost} defaultQuality={videoQualityPreference.quality} run={run} />
        </div>
      </aside>}
    </div>
    <div ref={band} hidden={!current} data-player-band={shown ? "shown" : "hidden"} inert={!shown} className={cn("player-band z-20 py-3 transition-opacity duration-200 [view-transition-name:couch-player-band] motion-reduce:transition-none", artworkStage ? "bg-background" : "player-video-controls", !shown && "opacity-0")}>
      {/* Gutter to gutter like the mini player, in its order: transport, timeline, volume, Where it plays, Up next, then settings and fullscreen.
          A timeline takes its own row above (index.css); live that can't seek leaves "Live" in its slot. Every tool is an icon. */}
      <div className="grid gap-1">
        {current && !artworkStage && <div data-player-heading className="flex min-w-0 items-center gap-3"><span className="flex min-w-0 items-center gap-1"><h1 title={current.title} className="truncate text-sm font-medium">{current.title}</h1>{details}</span>{current.subtitle && <span className="truncate text-xs text-muted-foreground">{current.subtitle}</span>}{!connected && <span className="truncate text-sm text-muted-foreground">{offline(name)}</span>}</div>}
        <div className="player-control-row">
          {state && <PlaybackTimeline state={state} connected={connected} run={run} pageFirst compact />}
          {state && <PlaybackTransport state={state} credentials={credentials} connected={connected} run={run} showSettings={false} pageFirst prominent />}
          <div data-player-tools className="flex shrink-0 items-center">
            {state && <VolumeButton state={state} connected={connected} run={run} className="size-11" />}
            {state && <WhereItPlays state={state} run={run} className="size-11" />}
            <Button ref={queueTrigger} data-panel="queue" variant="ghost" size="icon" className="size-11" aria-label="Up next" title="Up next" aria-expanded={queueOpen} disabled={queueBeside} onClick={() => setQueueOpen(!queueOpen)}><ListMusic aria-hidden="true" /></Button>
            <Button data-panel="settings" variant="ghost" size="icon" className="size-11" aria-label="Playback" title="Playback" aria-pressed={panel === "settings" || panel === "tracks"} onClick={event => openPanel("settings", event.currentTarget)}><Settings aria-hidden="true" /></Button>
            <Button variant="ghost" size="icon" className="size-11" disabled={!fullscreen.supported || fullscreen.pending} aria-label={fullscreen.fullscreen ? "Exit fullscreen" : "Enter fullscreen"} title={fullscreen.fullscreen ? "Exit fullscreen" : "Enter fullscreen"} onClick={() => void fullscreen.toggle()}>{fullscreen.fullscreen ? <Minimize aria-hidden="true" /> : <Maximize aria-hidden="true" />}</Button>
          </div>
        </div>
      </div>
    </div>
    <Sheet modal={false} open={panel !== null} onOpenChange={open => { if (!open) setPanelState(null); }}>
      <SheetContent side="right" data-player-sheet aria-describedby={undefined} className="gap-0 overflow-y-auto bg-background data-[side=right]:w-full data-[side=right]:sm:max-w-lg" showCloseButton={false} onOpenAutoFocus={event => { event.preventDefault(); panelClose.current?.focus(); }} onCloseAutoFocus={event => { event.preventDefault(); panelTrigger.current?.focus(); }}>
        <SheetHeader className="sticky top-0 z-10 flex-row items-center justify-between gap-2 border-b bg-background px-6 py-4"><SheetTitle className="text-base font-medium">{panel && panelTitles[panel]}</SheetTitle><SheetClose asChild><Button ref={panelClose} variant="ghost" size="icon" aria-label="Close"><X aria-hidden="true" /></Button></SheetClose></SheetHeader>
        <div className="px-6 pt-4 pb-8">
          {panel === "tracks" && <Button variant="ghost" className="-ml-2.5 mb-4 h-11" onClick={() => { if (player?.playbackId) setPanelState({ playbackId: player.playbackId, panel: "settings" }); }}><ArrowLeft aria-hidden="true" />Playback</Button>}
          {panel === "settings" && <div className="grid divide-y border-b">
            {!audioOnly && <Button variant="ghost" className="h-14 justify-start rounded-none px-0" onClick={() => { if (player?.playbackId) setPanelState({ playbackId: player.playbackId, panel: "tracks" }); }}><Captions aria-hidden="true" />Audio & subtitles<ChevronRight aria-hidden="true" className="ml-auto" /></Button>}
            {detailHref && <Button asChild variant="ghost" className="h-14 justify-start rounded-none px-0"><Link to={detailHref}><Info aria-hidden="true" />Details<ChevronRight aria-hidden="true" className="ml-auto" /></Link></Button>}
            <Button variant="ghost" className="h-14 justify-start rounded-none px-0" disabled={!available || !active} onClick={() => void run({ type: "stop" })}><Square aria-hidden="true" className="fill-current" />Stop</Button>
          </div>}
          {panel && player && state?.preferences && <PlaybackSettingsPanel panel={panel} entry={current} player={player} ready={transportReady} connected={connected} credentials={credentials} preferences={state.preferences} profile={state.activeProfile} onCommand={run} />}
        </div>
      </SheetContent>
    </Sheet>
  </section>;
}
