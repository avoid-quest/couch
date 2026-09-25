import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Captions, ListVideo, Music2, Settings2, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { AuthArtwork } from "@/components/AuthArtwork";
import { MediaArtwork } from "@/components/MediaArtwork";
import { PlaybackTimeline, PlaybackTransport, PlaybackVolume, playbackCapabilities } from "@/components/PlaybackTransport";
import { sourceLabel } from "@/source-label";
import { PlaybackSettingsPanel } from "@/components/PlaybackSettings";
import { formatDuration } from "@/time-format";
import { VideoStage } from "@/sections/shell/VideoStage";
import { QueuePanel } from "./QueuePanel";
import { useShell } from "@/sections/shell/AppShell";

type Panel = "queue" | "tracks" | "settings";

export function PlayerPage() {
  const shell = useShell();
  const { state, credentials, connected, run, available, nativeHost, localHost, active, current, programme, videoQualityPreference } = shell;
  const [panel, setPanel] = useState<Panel | null>(null);
  const [shown, setShown] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const root = useRef<HTMLElement>(null);
  const panelTrigger = useRef<HTMLButtonElement>(null);
  const panelClose = useRef<HTMLButtonElement>(null);
  const [now, setNow] = useState(Date.now());
  const player = state?.player;
  const playing = player?.status === "playing";
  const { transportReady } = playbackCapabilities(state, connected);
  const currentIndex = state?.queue.findIndex(entry => entry.id === state.currentEntryId) ?? -1;
  const following = currentIndex >= 0 ? state?.queue[currentIndex + 1] : undefined;
  const live = !!(current?.live || current?.kind === "radio" || current?.source.startsWith("radio:"));
  const retry = state?.radioRetry?.retryAt != null && player?.status === "loading" ? state.radioRetry : null;
  const retrySeconds = retry ? Math.max(0, Math.ceil((retry.retryAt! - now) / 1000)) : 0;
  const remaining = current?.duration != null ? Math.max(0, (player?.duration ?? current.duration) - (player?.position ?? 0)) / (player?.speed || 1) : null;
  const wake = () => {
    setShown(true);
    clearTimeout(timer.current);
    if (playing && !panel) timer.current = setTimeout(() => setShown(false), 4000);
  };
  useEffect(() => {
    clearTimeout(timer.current);
    if (!playing || panel) setShown(true);
    else timer.current = setTimeout(() => setShown(false), 4000);
    return () => clearTimeout(timer.current);
  }, [playing, panel]);
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
        if (panel) setPanel(null); else shell.leavePlayer();
        return;
      }
      const inPlayer = root.current?.contains(document.activeElement) || document.activeElement === document.body;
      if (!panel && !shown && inPlayer && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter", " "].includes(event.key)) {
        event.preventDefault(); event.stopImmediatePropagation(); wake();
        requestAnimationFrame(() => root.current?.querySelector<HTMLElement>('[role="slider"], .play-button, [data-primary]')?.focus());
        return;
      }
      if (!panel && event.key === " " && inPlayer && !(event.target instanceof HTMLElement && event.target.closest('button, a, input, select, textarea, [role="slider"]')) && transportReady && player?.playbackId) {
        event.preventDefault(); void run({ type: "pause", playbackId: player.playbackId, paused: playing });
      }
      if (inPlayer) wake();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [shown, panel, playing, transportReady, player?.playbackId, run, shell.leavePlayer]);
  const elsewhere = !localHost && active;
  const audioOnly = current?.kind === "radio" || !!player?.tracks?.some(track => track.kind === "audio") && !player.tracks.some(track => track.kind === "video" && track.selected);
  const currentProgramme = programme?.playbackId === player?.playbackId ? programme : null;
  const artwork = currentProgramme?.artworkUrl ? <MediaArtwork thumbnail={currentProgramme.artworkUrl} title={currentProgramme.title} /> : current?.artworkId ? <AuthArtwork origin={credentials.origin} token={credentials.token} id={current.artworkId} /> : current?.thumbnail ? <MediaArtwork thumbnail={current.thumbnail} title={current.title} /> : undefined;
  const openPanel = (value: Panel, trigger: HTMLButtonElement) => { panelTrigger.current = trigger; setPanel(value); setShown(true); };
  if (!current) return <section ref={root} className="player-idle min-h-[calc(100dvh-var(--shell-header))] py-8" data-page="Now" aria-label="Up next">
    <div className="mb-6 flex items-center justify-between gap-4"><h1 className="text-3xl font-semibold">Up next</h1><Button data-page-first variant="ghost" onClick={() => shell.changeSection("Find")}>Find something to play</Button></div>
    {player?.status === "unavailable" && <p role="status" className="mb-6 text-muted-foreground">Player unavailable. Check the playback host.</p>}
    <QueuePanel state={state} credentials={credentials} connected={connected} available={available} nativeHost={nativeHost} defaultQuality={videoQualityPreference.quality} run={run} />
  </section>;
  return <section ref={root} className="player-page" data-page="Now" aria-label="Player" onMouseMove={playing ? wake : undefined}>
    <div className="player-picture" onClick={() => { if (!shown) { wake(); return; } if (!audioOnly && active && player?.playbackId && transportReady) void run({ type: "pause", playbackId: player.playbackId, paused: playing }); }}>
      {elsewhere ? <div className="flex h-full flex-col justify-center gap-6 px-5 pt-6 pb-56 sm:px-8 lg:flex-row lg:items-center lg:justify-start lg:gap-12 lg:px-20 lg:pb-48">{artwork && <div className="aspect-video w-full max-w-80 shrink-0 overflow-hidden lg:w-[min(35vw,35rem)] lg:max-w-none [&_img]:size-full [&_img]:object-cover">{artwork}</div>}<div className="min-w-0"><p className="text-lg text-muted-foreground">Playing on {state?.installationName || "another Couch"}</p><h1 className="my-2 break-words text-[clamp(2rem,5vw,3rem)] leading-tight font-semibold">{current?.title}</h1><p className="max-w-[50ch] text-base text-muted-foreground sm:text-lg">The picture and sound are on {state?.installationName || "another Couch"}. Everything here controls it.</p></div></div>
        : <><VideoStage active={active} title={current?.title || "Your media"} audioOnly={audioOnly} artwork={artwork} />{active && audioOnly && current && <div className="player-audio-stage"><div className="player-audio-art" aria-hidden="true">{artwork || <Music2 />}</div><div className="player-audio-copy"><h1>{currentProgramme?.title || current.title}</h1><p>{currentProgramme ? current.title : sourceLabel(current.source)}</p>{player?.nowPlaying && <p className="player-audio-now" role="status">Playing now: {[player.nowPlaying.artist, player.nowPlaying.title].filter(Boolean).join(" — ")}</p>}</div></div>}</>}
    </div>
    {current && player?.status === "loading" && player.buffering && <Badge variant="outline" className="absolute top-8 left-10 z-10 h-auto rounded-sm border-white/20 bg-black px-4 py-2 text-sm font-normal text-white" role="status">Buffering</Badge>}
    {current && ((player?.status === "loading" && !player.buffering) || player?.status === "error") && <div className="player-status" role="status"><div className="w-[min(34rem,85vw)] space-y-2 bg-black py-8 text-white">
      <h2 className="text-2xl font-semibold">{retry ? `Reconnecting to ${current.title}` : player.status === "loading" ? `Loading ${current.title}` : player.error || `Can't play ${current.title}`}</h2>
      <p className="text-sm text-white/70">{retry ? `Next try in ${retrySeconds} s. Attempt ${retry.attempt} of ${retry.maximum}.` : player.status === "loading" ? `Asking ${sourceLabel(current.source)} for the stream.` : current.kind === "radio" || current.source.startsWith("radio:") ? "The station stopped sending audio." : current.source.startsWith("file:") || current.source.startsWith("library:") ? "The file is missing from its folder." : current.live ? "This stream has ended." : "This video is unavailable."}</p>
      {player.status === "loading" && !retry && <Progress value={33} className="player-loading-track mt-5" aria-label="Loading stream" />}
      {(retry || player.status === "error") && <div className="mt-6 flex flex-wrap gap-2"><Button disabled={!available} onClick={() => void run({ type: "play", entryId: current.id })}>{retry ? "Try now" : "Try again"}</Button><Button variant="ghost" disabled={!available} onClick={() => void run(player.playbackId ? { type: "next", playbackId: player.playbackId } : following ? { type: "play", entryId: following.id } : { type: "stop" })}>Skip</Button>{player.status === "error" && <Button variant="ghost" onClick={shell.leavePlayer}>Find something else</Button>}</div>}
    </div></div>}
    {current && <div className={`player-band ${shown ? "" : "player-band-hidden"}`} inert={!shown}>
      <div className="player-band-heading"><Button data-back variant="ghost" className="player-back" onClick={shell.leavePlayer}><ArrowLeft aria-hidden="true" />{shell.playerBackLabel || "Find"}</Button><h1 title={current.title}>{current.title}</h1><span>{!connected ? `Reconnecting to ${state?.installationName || "Couch"}` : [sourceLabel(current.source), state?.playedBy && state.playedBy.deviceId !== shell.identity?.controller?.id ? `started from ${state.playedBy.name}` : null].filter(Boolean).join(", ")}</span></div>
      {live ? <><div className="player-live-line" /><div className="player-live-time"><span>Live</span><span>{player?.nowPlaying ? [player.nowPlaying.artist, player.nowPlaying.title].filter(Boolean).join(" · ") : "No end time"}</span></div></> : state && <PlaybackTimeline state={state} connected={connected} run={run} pageFirst />}
      <div className="player-band-actions">
        {state && <PlaybackTransport state={state} credentials={credentials} connected={connected} run={run} showSettings={false} pageFirst />}
        {!following && <Button variant="ghost" size="icon" className="player-next-disabled" aria-label="Next in queue" disabled><SkipForward aria-hidden="true" /></Button>}
        <Button data-panel="queue" variant="ghost" aria-pressed={panel === "queue"} onClick={event => openPanel("queue", event.currentTarget)}><ListVideo aria-hidden="true" />{following ? <>Next: {following.title}<span>{remaining !== null && ` in ${formatDuration(remaining)}`}{currentIndex + 2 < (state?.queue.length ?? 0) && `, then ${(state?.queue.length ?? 0) - currentIndex - 2} more`}</span></> : <span>Nothing next</span>}</Button>
        <div className="player-band-right">{state && <PlaybackVolume state={state} connected={connected} run={run} showSlider={false} />}{!audioOnly && <Button data-panel="tracks" variant="ghost" aria-pressed={panel === "tracks"} onClick={event => openPanel("tracks", event.currentTarget)}><Captions aria-hidden="true" />Audio & subtitles</Button>}<Button data-panel="settings" variant="ghost" aria-pressed={panel === "settings"} onClick={event => openPanel("settings", event.currentTarget)}><Settings2 aria-hidden="true" />Settings</Button></div>
      </div>
    </div>}
    <Sheet modal={false} open={panel !== null} onOpenChange={open => { if (!open) setPanel(null); }}><SheetContent side="right" className="player-sheet overflow-y-auto shadow-none" showCloseButton={false} onOpenAutoFocus={event => { event.preventDefault(); panelClose.current?.focus(); }} onCloseAutoFocus={event => { event.preventDefault(); panelTrigger.current?.focus(); }}><SheetHeader className="flex-row items-center gap-2 px-[2.2rem] pt-[1.6rem] pb-[.4rem]"><SheetClose asChild><Button ref={panelClose} variant="ghost"><ArrowLeft aria-hidden="true" />Close</Button></SheetClose><SheetTitle className="text-[1.4rem] font-semibold">{panel === "queue" ? "Up next" : panel === "tracks" ? "Audio & subtitles" : "Settings"}</SheetTitle></SheetHeader>{panel === "queue" ? <QueuePanel state={state} credentials={credentials} connected={connected} available={available} nativeHost={nativeHost} defaultQuality={videoQualityPreference.quality} run={run} /> : panel && player && state?.preferences && <PlaybackSettingsPanel panel={panel} entry={current} player={player} ready={transportReady} connected={connected} credentials={credentials} preferences={state.preferences} profile={state.activeProfile} onCommand={run} />}</SheetContent></Sheet>
  </section>;
}
