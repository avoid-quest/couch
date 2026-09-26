import { getCurrentWindow } from "@tauri-apps/api/window";
import { usePlaybackClock } from "@/session/playback-clock";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Captions, Info, ListVideo, Maximize, Minimize, Music2, Settings2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { AuthArtwork } from "@/components/AuthArtwork";
import { MediaArtwork } from "@/components/MediaArtwork";
import { PlaybackTimeline, PlaybackTransport, PlaybackVolume, playbackCapabilities } from "@/components/PlaybackTransport";
import { sourceLabel } from "@/source-label";
import { PlaybackSettingsPanel } from "@/components/PlaybackSettings";
import { formatDuration } from "@/time-format";
import { deviceName } from "@/copy";
import { VideoStage } from "@/sections/shell/VideoStage";
import { useBottomBar } from "@/sections/shell/MiniPlayer";
import { QueuePanel } from "./QueuePanel";
import { usePlayerFullscreen } from "./usePlayerFullscreen";
import { useShell } from "@/sections/shell/AppShell";
import { useSessionGate } from "@/session/session-context";
import { cn } from "@/lib/utils";

type Panel = "queue" | "tracks" | "settings" | "info";
const panelTitles: Record<Panel, string> = { queue: "Up next", tracks: "Audio & subtitles", settings: "Playback", info: "Show details" };

export function PlayerPage() {
  const playbackClock = usePlaybackClock();
  const fullscreen = usePlayerFullscreen();
  const shell = useShell();
  const { credentials, available, active, current, programme } = shell;
  const { state, connected, run, nativeHost, localHost, videoQualityPreference } = useSessionGate();
  const [panelState, setPanelState] = useState<{ playbackId: string; panel: Panel } | null>(null);
  const [shown, setShown] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const root = useRef<HTMLElement>(null);
  const band = useRef<HTMLDivElement>(null);
  const panelTrigger = useRef<HTMLButtonElement>(null);
  const panelClose = useRef<HTMLButtonElement>(null);
  const [now, setNow] = useState(Date.now());
  const player = state?.player;
  const panel = active && current && panelState?.playbackId === player?.playbackId ? panelState?.panel ?? null : null;
  const playing = player?.status === "playing";
  useBottomBar(band, !!current && shown);
  useEffect(() => { setPanelState(null); }, [active, player?.playbackId]);
  const { transportReady } = playbackCapabilities(state, connected);
  const name = deviceName(state?.installationName);
  const currentIndex = state?.queue.findIndex(entry => entry.id === state.currentEntryId) ?? -1;
  const following = currentIndex >= 0 ? state?.queue[currentIndex + 1] : undefined;
  const live = !!(current?.live || current?.kind === "radio" || current?.source.startsWith("radio:"));
  const retry = state?.radioRetry?.retryAt != null && player?.status === "loading" ? state.radioRetry : null;
  const retrySeconds = retry ? Math.max(0, Math.ceil((retry.retryAt! - now) / 1000)) : 0;
  const remaining = current?.duration != null ? Math.max(0, (playbackClock.duration ?? current.duration) - (playbackClock.position ?? 0)) / (player?.speed || 1) : null;
  const wake = () => {
    setShown(true);
    clearTimeout(timer.current);
    if (playing && !panel) timer.current = setTimeout(() => { if (!root.current?.querySelector(":focus-visible")) setShown(false); }, 4000);
  };
  useEffect(() => {
    clearTimeout(timer.current);
    if (!playing || panel) setShown(true);
    else timer.current = setTimeout(() => { if (!root.current?.querySelector(":focus-visible")) setShown(false); }, 4000);
    return () => clearTimeout(timer.current);
  }, [playing, panel]);
  useEffect(() => {
    if (!nativeHost || !current || shown) return;
    const playerWindow = getCurrentWindow();
    void playerWindow.setCursorVisible(false).catch(() => {});
    return () => { void playerWindow.setCursorVisible(true).catch(() => {}); };
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
        if (document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="listbox"][data-state="open"], [data-slot="popover-content"][data-state="open"]')) return;
        event.preventDefault(); event.stopImmediatePropagation();
        if (panel) setPanelState(null);
        else if (event.key === "Escape" && fullscreen.supported && fullscreen.fullscreen) void fullscreen.toggle();
        else shell.leavePlayer();
        return;
      }
      const inPlayer = root.current?.contains(document.activeElement) || document.activeElement === document.body;
      if (!panel && !shown && inPlayer && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter", " "].includes(event.key)) {
        event.preventDefault(); event.stopImmediatePropagation(); wake();
        requestAnimationFrame(() => root.current?.querySelector<HTMLElement>('[role="slider"], [data-play-button], [data-primary]')?.focus());
        return;
      }
      if (!panel && event.key === " " && inPlayer && !(event.target instanceof HTMLElement && event.target.closest('button, a, input, select, textarea, [role="slider"]')) && transportReady && player?.playbackId) {
        event.preventDefault(); void run({ type: "pause", playbackId: player.playbackId, paused: playing });
      }
      if (inPlayer) wake();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [shown, panel, playing, transportReady, player?.playbackId, run, shell.leavePlayer, fullscreen]);
  // The shell sends an idle player back to Home, which shows Up next.
  if (!current) return null;

  const elsewhere = !localHost && active;
  const audioOnly = current.kind === "radio" || !!player?.tracks?.some(track => track.kind === "audio") && !player.tracks.some(track => track.kind === "video" && track.selected);
  const currentProgramme = programme?.playbackId === player?.playbackId ? programme : null;
  const artwork = currentProgramme?.artworkUrl ? <MediaArtwork thumbnail={currentProgramme.artworkUrl} title={currentProgramme.title} /> : current.artworkId ? <AuthArtwork origin={credentials.origin} token={credentials.token} id={current.artworkId} /> : current.thumbnail ? <MediaArtwork thumbnail={current.thumbnail} title={current.title} /> : undefined;
  const openPanel = (value: Panel, trigger: HTMLButtonElement) => { if (!player?.playbackId) return; panelTrigger.current = trigger; setPanelState({ playbackId: player.playbackId, panel: value }); setShown(true); };
  const source = sourceLabel(current.source);
  const heading = !connected ? `Reconnecting to ${name}…` : [player?.nowPlaying?.artist, source === "Media" ? null : source, state?.playedBy?.name && `played from ${state.playedBy.name}`].filter(Boolean).join(" · ");
  const nowPlaying = player?.nowPlaying && [player.nowPlaying.artist, player.nowPlaying.title].filter(Boolean).join(" — ");
  const programmeDetails = currentProgramme && <>
    {currentProgramme.genre && <Badge variant="secondary" className="h-auto max-w-full whitespace-normal break-all">{currentProgramme.genre}</Badge>}
    {(currentProgramme.artist || currentProgramme.album || currentProgramme.bitrate) && <p className="text-sm text-muted-foreground">{[currentProgramme.artist, currentProgramme.album, currentProgramme.bitrate && `${currentProgramme.bitrate} kbps`].filter(Boolean).join(" · ")}</p>}
    {currentProgramme.description && <p className="max-w-prose text-sm text-muted-foreground">{currentProgramme.description}</p>}
    {!nativeHost && currentProgramme.programmeUrl && <Button asChild variant="link" className="pointer-events-auto h-auto w-fit p-0"><a href={currentProgramme.programmeUrl} target="_blank" rel="noopener noreferrer">About this show</a></Button>}
  </>;
  const unavailable = connected && player?.status === "unavailable";
  const errorDetail = current.kind === "radio" || current.source.startsWith("radio:") ? "The station stopped sending audio." : current.source.startsWith("file:") || current.source.startsWith("library:") ? "The file is missing from its folder." : current.live ? "This stream has ended." : "This video is unavailable.";
  const skip = () => void run(player?.playbackId ? { type: "next", playbackId: player.playbackId } : following ? { type: "play", entryId: following.id } : { type: "stop" });
  const status = unavailable ? { title: `Player not running on ${localHost ? "this computer" : name}`, detail: "Browsing and Up next still work." }
    : player?.status === "error" ? { title: player.error || `Can't play ${current.title}`, detail: errorDetail }
    : retry ? { title: `Reconnecting to ${current.title}`, detail: `Retrying in ${retrySeconds} s (${retry.attempt} of ${retry.maximum})`, busy: true }
    : player?.status === "loading" && !player.buffering ? { title: `Loading ${current.title}`, detail: `Connecting to ${source}…`, busy: true }
    : null;

  return <section ref={root} className={cn("player-page fixed inset-0 overflow-hidden bg-background", !shown && "cursor-none [&_*]:cursor-none")} data-page="Now" aria-label="Player" onPointerMove={wake} onFocus={wake} onBlur={wake}>
    <div className="absolute inset-0" onClick={() => { if (!shown) { wake(); return; } if (!audioOnly && active && player?.playbackId && transportReady) void run({ type: "pause", playbackId: player.playbackId, paused: playing }); }}>
      {!elsewhere && <VideoStage active={active} audioOnly={audioOnly} />}
      {(elsewhere || active && audioOnly) && !status && <div data-player-summary className="player-summary" style={{ bottom: shown ? "var(--bottom-bar, 0px)" : 0 }}>
        <div data-player-art aria-hidden="true" className="player-art grid min-h-0 min-w-0 place-items-center overflow-hidden">{artwork || <Music2 className="size-12 text-muted-foreground" />}</div>
        <div data-player-audio-copy className="grid min-w-0 gap-2">
          <p className="truncate text-sm text-muted-foreground">{elsewhere ? `Playing on ${name}` : currentProgramme ? current.title : source}</p>
          <h2 className="line-clamp-2 text-2xl font-semibold tracking-tight break-words" title={currentProgramme?.title || current.title}>{currentProgramme?.title || current.title}</h2>
          {nowPlaying && <p role="status" className="truncate text-sm text-muted-foreground">{nowPlaying}</p>}
        </div>
      </div>}
    </div>
    {player?.status === "loading" && player.buffering && <p role="status" className="absolute top-6 left-(--gutter) z-10 flex items-center gap-2 bg-background px-3 py-2 text-sm"><Spinner role="presentation" aria-label={undefined} aria-hidden="true" />Buffering…</p>}
    {status && <div data-player-status className="pointer-events-none absolute inset-0 z-10 grid place-items-center px-(--gutter) pb-48">
      <div role="status" className="pointer-events-auto grid max-w-lg gap-2 bg-background p-6">
        <h2 className="text-2xl font-semibold tracking-tight break-words">{status.title}</h2>
        <p className="flex items-center gap-2 text-sm text-muted-foreground">{status.busy && <Spinner role="presentation" aria-label={undefined} aria-hidden="true" />}{status.detail}</p>
        {(retry || player?.status === "error") && <div className="mt-4 flex flex-wrap gap-2">
          <Button disabled={!available} onClick={() => void run({ type: "play", entryId: current.id })}>{retry ? "Try now" : "Try again"}</Button>
          <Button variant="ghost" disabled={!available} onClick={skip}>Skip</Button>
          {player?.status === "error" && <Button variant="ghost" onClick={shell.leavePlayer}>{shell.playerBackLabel || "Find"}</Button>}
        </div>}
      </div>
    </div>}
    <div ref={band} data-player-band={shown ? "shown" : "hidden"} inert={!shown} className={cn("absolute inset-x-0 bottom-0 z-20 grid gap-3 bg-background px-(--gutter) pt-4 pb-6 transition-transform duration-300 [view-transition-name:couch-player-band] motion-reduce:transition-none", !shown && "translate-y-full")}>
      <div data-player-heading className="flex min-w-0 flex-wrap items-baseline gap-x-4">
        <Button data-back variant="ghost" className="-ml-2.5 self-center text-muted-foreground" onClick={shell.leavePlayer}><ArrowLeft aria-hidden="true" />{shell.playerBackLabel || "Find"}</Button>
        <h1 title={current.title} className="min-w-0 flex-1 truncate text-3xl font-semibold tracking-tight">{current.title}</h1>
        <span className="ml-auto shrink-0 text-sm text-muted-foreground max-sm:basis-full max-sm:ml-0">{heading}</span>
      </div>
      {live ? <div className="grid gap-1"><div className="h-1 bg-foreground" /><div className="flex justify-between gap-4 text-sm text-muted-foreground"><span className="text-foreground">Live</span><span className="truncate">{nowPlaying || "No end time"}</span></div></div>
        : state && <PlaybackTimeline state={state} connected={connected} run={run} pageFirst />}
      <div className="flex flex-wrap items-center gap-x-1 gap-y-2">
        {state && <PlaybackTransport state={state} credentials={credentials} connected={connected} run={run} showSettings={false} pageFirst />}
        <Button data-panel="queue" variant="ghost" className="min-w-0 max-w-full flex-1 basis-48 justify-start sm:ml-4 sm:flex-none" aria-pressed={panel === "queue"} onClick={event => openPanel("queue", event.currentTarget)}>
          <ListVideo aria-hidden="true" />{following ? <><span className="truncate">Next: {following.title}</span><span className="shrink-0 font-normal text-muted-foreground">{remaining !== null && `in ${formatDuration(remaining)}`}{currentIndex + 2 < (state?.queue.length ?? 0) && `, then ${(state?.queue.length ?? 0) - currentIndex - 2} more`}</span></> : "Up next"}
        </Button>
        <div data-player-tools className="ml-auto flex min-w-0 flex-wrap items-center gap-1 max-sm:w-full">
          {state && <PlaybackVolume state={state} connected={connected} run={run} className="max-w-64" />}
          {currentProgramme && <Button data-panel="info" variant="ghost" size="icon" aria-label="Show details" title="Show details" aria-pressed={panel === "info"} onClick={event => openPanel("info", event.currentTarget)}><Info aria-hidden="true" /></Button>}
          {!audioOnly && <Button data-panel="tracks" variant="ghost" className="touch:min-w-11" aria-pressed={panel === "tracks"} title="Audio & subtitles" onClick={event => openPanel("tracks", event.currentTarget)}><Captions aria-hidden="true" /><span className="max-sm:sr-only">Audio & subtitles</span></Button>}
          {fullscreen.supported && <Button variant="ghost" size="icon" className="touch:min-w-11" disabled={fullscreen.pending} aria-label={fullscreen.fullscreen ? "Exit fullscreen" : "Enter fullscreen"} title={fullscreen.fullscreen ? "Exit fullscreen" : "Enter fullscreen"} onClick={() => void fullscreen.toggle()}>{fullscreen.fullscreen ? <Minimize aria-hidden="true" /> : <Maximize aria-hidden="true" />}</Button>}
          <Button data-panel="settings" variant="ghost" className="touch:min-w-11" aria-pressed={panel === "settings"} title="Playback" onClick={event => openPanel("settings", event.currentTarget)}><Settings2 aria-hidden="true" /><span className="max-sm:sr-only">Playback</span></Button>
        </div>
      </div>
    </div>
    <Sheet modal={false} open={panel !== null} onOpenChange={open => { if (!open) setPanelState(null); }}>
      <SheetContent side="right" data-player-sheet aria-describedby={undefined} className="gap-0 overflow-y-auto bg-background data-[side=right]:w-full data-[side=right]:sm:max-w-md" showCloseButton={false} onOpenAutoFocus={event => { event.preventDefault(); panelClose.current?.focus(); }} onCloseAutoFocus={event => { event.preventDefault(); panelTrigger.current?.focus(); }}>
        <SheetHeader className="flex-row items-center gap-2 px-6 pt-6 pb-2"><SheetClose asChild><Button ref={panelClose} variant="ghost" className="-ml-2.5"><ArrowLeft aria-hidden="true" />Close</Button></SheetClose><SheetTitle className="text-base font-medium">{panel && panelTitles[panel]}</SheetTitle></SheetHeader>
        <div className="px-6 pb-8">
          {panel === "info" ? <div className="grid gap-3"><h3 className="text-xl font-semibold break-words">{currentProgramme?.title}</h3>{programmeDetails}</div> : panel === "queue" ? <QueuePanel state={state} credentials={credentials} connected={connected} available={available} nativeHost={nativeHost} defaultQuality={videoQualityPreference.quality} run={run} titled={false} />
            : panel && player && state?.preferences && <PlaybackSettingsPanel panel={panel} entry={current} player={player} ready={transportReady} connected={connected} credentials={credentials} preferences={state.preferences} profile={state.activeProfile} onCommand={run} />}
        </div>
      </SheetContent>
    </Sheet>
  </section>;
}
