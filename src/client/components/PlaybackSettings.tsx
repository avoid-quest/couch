import { Check, Minus, Plus, Settings } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { WatchingProfile } from "../../shared/library";
import type { Action, PlaybackPreferences as Preferences, PlayerState, QueueEntry, ReplayGainMode } from "../../shared/protocol";
import type { Credentials } from "@/session/session";
import { playbackDefault, type PlaybackDefaultSetting } from "../../shared/playback-default";
import { QualitySelect } from "@/components/QualitySelect";
import { supportsCurrentVideoQuality } from "../../shared/video-quality";
import { videoQualityLabels } from "@/video-quality";

export type PlaybackSettingsProps = {
  entry?: QueueEntry;
  player: PlayerState;
  ready: boolean;
  connected: boolean;
  credentials: Credentials;
  preferences: Preferences;
  profile: WatchingProfile;
  onCommand: (action: Action) => Promise<boolean>;
};

function SubtitleUpload({ playbackId, credentials, connected, disabled, compact = false }: {
  playbackId: string | null;
  credentials: Credentials;
  connected: boolean;
  disabled: boolean;
  compact?: boolean;
}) {
  const id = useId();
  const request = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    const previous = request.current;
    previous?.abort();
    request.current = null;
    setPending(false);
    setError(previous ? "Playback or the connection changed. Choose your subtitle file again." : null);
    setNotice(null);
  }, [playbackId, credentials.origin, credentials.token, connected]);
  useEffect(() => () => request.current?.abort(), []);

  const upload = async (file: File) => {
    if (!playbackId || disabled || request.current) return;
    setError(null);
    setNotice(null);
    if (!/\.(srt|ass|ssa|vtt)$/i.test(file.name)) {
      setError("Choose an SRT, ASS, SSA or VTT subtitle file.");
      return;
    }
    if (!file.size || file.size > 2 * 1024 * 1024) {
      setError("Choose a nonempty subtitle file up to 2 MiB.");
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    try {
      const query = new URLSearchParams({ playbackId, name: file.name });
      const response = await fetch(`${credentials.origin}/api/subtitles?${query}`, {
        method: "POST", headers: { Authorization: `Bearer ${credentials.token}`, "Content-Type": "application/octet-stream" }, body: file,
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
      });
      const result = await response.json();
      if (!response.ok || result.ok !== true) throw new Error(result.error || "Could not add this subtitle file.");
      if (!controller.signal.aborted) setNotice("Subtitle sent. The Subtitles list shows the playback host's current selection.");
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not add this subtitle file.");
    } finally {
      if (request.current === controller) {
        request.current = null;
        setPending(false);
      }
    }
  };

  return <div className="grid gap-2">
    {compact ? <Button variant="ghost" className="min-h-11 w-full justify-start gap-3 px-3 font-normal" disabled={disabled || pending || !playbackId} onClick={() => fileInput.current?.click()}><Plus className="size-4" aria-hidden="true" />Add subtitle file</Button> : <Label htmlFor={id}>Add subtitle file</Label>}
    <Input ref={fileInput} id={id} type="file" tabIndex={compact ? -1 : undefined} className={compact ? "hidden" : "min-h-11"} accept=".srt,.ass,.ssa,.vtt" disabled={disabled || pending || !playbackId} aria-describedby={compact ? undefined : `${id}-help`} onChange={event => {
      const file = event.currentTarget.files?.[0];
      event.currentTarget.value = "";
      if (file) void upload(file);
    }} />
    {!compact && <p id={`${id}-help`} className="text-sm text-muted-foreground">SRT, ASS, SSA or VTT, up to 2 MiB.</p>}
    {pending && <p className="text-sm text-muted-foreground" role="status">Sending subtitle…</p>}
    {notice && <p className="text-sm text-primary" role="status">{notice}</p>}
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
  </div>;
}

export function DelayControl({ id, label, value, disabled, onApply }: {
  id: string;
  label: string;
  value: number;
  disabled: boolean;
  onApply: (delay: number) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const apply = async (event: FormEvent) => {
    event.preventDefault();
    if (draft === null) return;
    setPending(true);
    try {
      if (await onApply(Number(draft))) setDraft(null);
    } finally {
      setPending(false);
    }
  };
  return (
    <form className="delay-control grid gap-2" onSubmit={(event) => void apply(event)}>
      <Label htmlFor={id}>{label} <span className="text-muted-foreground font-normal">seconds</span></Label>
      <div className="delay-input flex gap-2">
        <Input id={id} className="min-h-11" type="number" min={-10} max={10} step={0.1} required value={draft ?? Number(value.toFixed(2))} disabled={disabled || pending} onChange={(event) => setDraft(event.target.value)} />
        <Button type="submit" variant="secondary" className="min-h-11" disabled={disabled || pending || draft === null}>{pending ? "Applying…" : "Apply"}</Button>
      </div>
    </form>
  );
}

function PanelGroup({ label, children }: { label: string; children: ReactNode }) {
  return <section className="mt-6"><h3 className="mb-2 px-3 text-sm font-normal text-muted-foreground">{label}</h3>{children}</section>;
}

function PanelOption({ value, selected, children, disabled, onClick }: { value: string; selected: boolean; children: ReactNode; disabled: boolean; onClick: () => void }) {
  return <ToggleGroupItem value={value} className="min-h-11 w-full justify-start gap-3 px-3 text-left font-normal" disabled={disabled} onClick={onClick}>
    <Check className={`size-4 shrink-0 ${selected ? "" : "invisible"}`} aria-hidden="true" /><span className="min-w-0 flex-1 truncate">{children}</span>
  </ToggleGroupItem>;
}

function PanelStepper({ label, value, disabled, onStep }: { label: string; value: string; disabled: boolean; onStep: (direction: -1 | 1) => void }) {
  return <div className="flex min-h-11 items-center gap-1 px-3"><span className="mr-auto">{label}</span>
    <ButtonGroup aria-label={`${label} adjustment`}>
    <Button variant="ghost" size="icon" className="size-11 shrink-0" aria-label={`${label} earlier`} disabled={disabled} onClick={() => onStep(-1)}><Minus className="size-4" aria-hidden="true" /></Button>
    <span className="w-16 text-center tabular-nums">{value}</span>
    <Button variant="ghost" size="icon" className="size-11 shrink-0" aria-label={`${label} later`} disabled={disabled} onClick={() => onStep(1)}><Plus className="size-4" aria-hidden="true" /></Button>
    </ButtonGroup>
  </div>;
}

export function PlaybackSettingsPanel({ entry, player, ready, connected, credentials, preferences, profile, onCommand, panel }: PlaybackSettingsProps & { panel: "tracks" | "settings" | "all" }) {
  const [pending, setPending] = useState(false);
  const [defaultError, setDefaultError] = useState<string | null>(null);
  const commandPending = useRef(false);
  const focusRequest = useRef<{ trigger: HTMLButtonElement; cancel: () => void } | null>(null);
  useEffect(() => {
    if (!ready || pending || !focusRequest.current) return;
    const frame = requestAnimationFrame(() => {
      const request = focusRequest.current;
      const active = document.activeElement;
      if (request?.trigger.isConnected && !request.trigger.disabled && request.trigger.getClientRects().length
        && (active === request.trigger || active === document.body || active === request.trigger.closest('[role="dialog"]'))) {
        request.trigger.focus({ preventScroll: true });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [ready, pending, player.playbackId, player.seekable, player.tracks]);
  useEffect(() => () => focusRequest.current?.cancel(), [entry?.id, profile.id, credentials.origin, credentials.token]);
  useEffect(() => setDefaultError(null), [player.playbackId, profile.id, connected]);
  const tracks = player.tracks ?? [];
  const audio = tracks.filter((track) => track.kind === "audio");
  const subtitles = tracks.filter((track) => track.kind === "subtitle");
  const chapters = player.chapters ?? [];
  const qualityAvailable = supportsCurrentVideoQuality(entry, player);
  const previousQuality = useRef<string | undefined>(undefined);
  const qualitySource = entry ? `${entry.id}:${entry.source}` : undefined;
  if (qualityAvailable) previousQuality.current = qualitySource;
  else if (!player.playbackId || previousQuality.current !== qualitySource) previousQuality.current = undefined;
  // Native status, seekability and tracks arrive separately during a reload.
  const showQuality = qualityAvailable || !!qualitySource && previousQuality.current === qualitySource;
  const video = showQuality || tracks.some(track => track.kind === "video");
  const chapterIndex = chapters.findLastIndex((chapter) => chapter.position <= player.position);
  const disabled = !ready || pending;
  const run = async (action: Action, focusId?: string) => {
    if (commandPending.current) return false;
    commandPending.current = true;
    const listbox = document.activeElement?.closest('[role="listbox"]');
    const trigger = focusId ? document.getElementById(focusId) as HTMLButtonElement | null
      : listbox?.id ? document.querySelector<HTMLButtonElement>(`[role="combobox"][aria-controls="${CSS.escape(listbox.id)}"]`) : null;
    focusRequest.current?.cancel();
    const cancelFocus = () => {
      document.removeEventListener("keydown", cancelFocus, true);
      document.removeEventListener("pointerdown", cancelFocus, true);
      focusRequest.current = null;
    };
    if (trigger) {
      focusRequest.current = { trigger, cancel: cancelFocus };
      document.addEventListener("keydown", cancelFocus, true);
      document.addEventListener("pointerdown", cancelFocus, true);
    }
    setPending(true);
    try {
      return await onCommand(action);
    } finally {
      commandPending.current = false;
      setPending(false);
      // Native reload can outlast the command acknowledgement. Restore once the control is ready.
    }
  };
  const selectTrack = (kind: "audio" | "subtitle", index: number) => {
    if (player.playbackId) void run({ type: "track", playbackId: player.playbackId, kind, index });
  };
  const saveDefault = (setting: PlaybackDefaultSetting, label: string) => {
    const patch = playbackDefault(player, setting);
    const saved = patch && Object.entries(patch).every(([key, value]) => preferences.profile[key as keyof typeof preferences.profile] === value);
    return patch && !saved && <Button variant="link" className="min-h-11 justify-start px-0" disabled={disabled} onClick={async () => {
      setDefaultError(null);
      if (player.playbackId && !await run({ type: "savePlaybackDefault", profileId: profile.id, playbackId: player.playbackId, setting })) setDefaultError("Could not save this default.");
    }}>Save {label} as default</Button>;

  };

  if (panel !== "all") {
    const seconds = (value: number) => `${value > 0 ? "+" : ""}${value.toFixed(1)} s`;
    const adjustDelay = (type: "audioDelay" | "subtitleDelay", value: number, direction: -1 | 1) => {
      if (player.playbackId) void run({ type, playbackId: player.playbackId, delay: Math.round((value + direction * 0.1) * 10) / 10 });
    };
    return <div className="playback-settings-panel pb-8 text-base">
      {panel === "tracks" ? <>
        <PanelGroup label="Subtitles">
          {subtitles.length ? <>
            <ToggleGroup type="single" value={String(subtitles.find(track => track.selected)?.index ?? -1)} orientation="vertical" aria-label="Subtitles" className="w-full gap-0">
            <PanelOption value="-1" selected={!subtitles.some(track => track.selected)} disabled={disabled} onClick={() => selectTrack("subtitle", -1)}>Off</PanelOption>
            {subtitles.map(track => <PanelOption key={track.id} value={String(track.index)} selected={track.selected} disabled={disabled} onClick={() => selectTrack("subtitle", track.index)}>{track.label || track.language || `Subtitle ${track.index + 1}`}</PanelOption>)}
            </ToggleGroup>
          </> : <p className="px-3 py-2 text-sm text-muted-foreground">No embedded subtitles</p>}
          <SubtitleUpload playbackId={player.playbackId} credentials={credentials} connected={connected} disabled={disabled} compact />
          {saveDefault("subtitles", "subtitles")}
        </PanelGroup>
        <PanelGroup label="Audio">
          {audio.length ? <ToggleGroup type="single" value={String(audio.find(track => track.selected)?.index ?? "")} orientation="vertical" aria-label="Audio" className="w-full gap-0">{audio.map(track => <PanelOption key={track.id} value={String(track.index)} selected={track.selected} disabled={disabled} onClick={() => selectTrack("audio", track.index)}>{track.label || track.language || `Audio ${track.index + 1}`}</PanelOption>)}</ToggleGroup>
            : <p className="px-3 py-2 text-sm text-muted-foreground">No alternate audio tracks</p>}
          {saveDefault("audio", "audio language")}
        </PanelGroup>
        <PanelGroup label="Timing"><PanelStepper label="Subtitles" value={seconds(player.subtitleDelay ?? 0)} disabled={disabled || !player.playbackId} onStep={direction => adjustDelay("subtitleDelay", player.subtitleDelay ?? 0, direction)} /></PanelGroup>
      </> : <>
        {chapters.length > 0 && player.seekable && <PanelGroup label="Chapters"><ToggleGroup type="single" value={String(chapterIndex)} orientation="vertical" aria-label="Chapters" className="w-full gap-0">{chapters.map((chapter, index) =>
          <PanelOption key={`${chapter.position}-${index}`} value={String(index)} selected={index === chapterIndex} disabled={disabled || !player.playbackId} onClick={() => { if (player.playbackId) void run({ type: "seek", playbackId: player.playbackId, position: chapter.position }); }}>
            <span className="flex w-full justify-between gap-4"><span className="truncate">{chapter.title || `Chapter ${index + 1}`}</span><span className="tabular-nums text-muted-foreground">{Math.floor(chapter.position / 60)}:{String(Math.floor(chapter.position % 60)).padStart(2, "0")}</span></span>
          </PanelOption>)}</ToggleGroup></PanelGroup>}
        {player.seekable && !entry?.live && <PanelGroup label="Speed"><ToggleGroup type="single" value={String(player.speed ?? 1)} aria-label="Speed" className="flex-wrap justify-start gap-1 px-2">{[...new Set([0.5, 0.75, 1, 1.25, 1.5, 2, player.speed ?? 1])].sort((a, b) => a - b).map(speed =>
          <ToggleGroupItem key={speed} value={String(speed)} className="min-h-11 gap-2 px-3" disabled={disabled || !player.playbackId} onClick={() => { if (player.playbackId) void run({ type: "speed", playbackId: player.playbackId, speed }); }}>
            <Check className={`size-4 ${(player.speed ?? 1) === speed ? "" : "invisible"}`} aria-hidden="true" />{speed}×
          </ToggleGroupItem>)}</ToggleGroup>{saveDefault("speed", "speed")}</PanelGroup>}
        {showQuality && <PanelGroup label="Quality"><ToggleGroup type="single" value={entry?.quality ?? "auto"} orientation="vertical" aria-label="Quality" className="w-full gap-0">{(Object.entries(videoQualityLabels) as [NonNullable<QueueEntry["quality"]>, string][]).map(([quality, label]) =>
          <PanelOption key={quality} value={quality} selected={(entry?.quality ?? "auto") === quality} disabled={disabled || !qualityAvailable || !player.playbackId} onClick={() => { if (player.playbackId) void run({ type: "videoQuality", playbackId: player.playbackId, quality }); }}>{label}</PanelOption>)}</ToggleGroup></PanelGroup>}
        {player.replayGain !== undefined && <PanelGroup label="Volume levelling"><ToggleGroup type="single" value={player.replayGain} orientation="vertical" aria-label="Volume levelling" className="w-full gap-0">{(["off", "track", "album"] as ReplayGainMode[]).map(mode =>
          <PanelOption key={mode} value={mode} selected={player.replayGain === mode} disabled={disabled || !player.playbackId} onClick={() => { if (player.playbackId) void run({ type: "replayGain", playbackId: player.playbackId, mode }); }}>{mode[0]!.toUpperCase() + mode.slice(1)}</PanelOption>)}</ToggleGroup>
          {saveDefault("replayGain", "volume normalization")}</PanelGroup>}
        <PanelGroup label="Sound">
          <PanelStepper label="Volume" value={String(player.volume)} disabled={!connected || pending} onStep={direction => { void run({ type: "volume", volume: Math.max(0, Math.min(100, player.volume + direction * 5)) }); }} />
          <PanelStepper label="Audio timing" value={seconds(player.audioDelay ?? 0)} disabled={disabled || !player.playbackId} onStep={direction => adjustDelay("audioDelay", player.audioDelay ?? 0, direction)} />
        </PanelGroup>
      </>}
      {pending && <p className="px-3 py-2 text-sm text-muted-foreground" role="status">Applying…</p>}
      {defaultError && <Alert variant="destructive"><AlertDescription>{defaultError}</AlertDescription></Alert>}
      {player.subtitleError && <Alert variant="destructive"><AlertDescription>{player.subtitleError}</AlertDescription></Alert>}
    </div>;
  }

  return (
    <div className="playback-settings">
      <Dialog onOpenChange={open => { if (!open) focusRequest.current?.cancel(); }}>
        <DialogTrigger asChild><Button variant="ghost" size="icon" className="icon-button min-h-11 min-w-11" aria-label="Playback settings" title="Playback settings"><Settings aria-hidden="true" /></Button></DialogTrigger>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Playback settings</DialogTitle>
            <DialogDescription>{entry?.title ? `Controls for ${entry.title}.` : "Controls for the current media."}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
            {showQuality && <QualitySelect id="playback-quality" label="Quality" value={entry?.quality ?? "auto"} disabled={disabled || !qualityAvailable} onChange={quality => {
              setDefaultError(null);
              if (player.playbackId) void run({ type: "videoQuality", playbackId: player.playbackId, quality }, "playback-quality").then(ok => { if (!ok) setDefaultError("Could not change quality."); });
            }} />}
            {audio.length > 1 && <div className="grid gap-2">
              <Label htmlFor="playback-audio">Audio track</Label>
              <Select value={String(audio.find(track => track.selected)?.index ?? "")} disabled={disabled} onValueChange={value => selectTrack("audio", Number(value))}>
                <SelectTrigger id="playback-audio" className="min-h-11 w-full"><SelectValue placeholder="Choose audio" /></SelectTrigger>
                <SelectContent>{audio.map(track => <SelectItem key={track.id} value={String(track.index)} className="min-h-11">{track.label || track.language || `Audio ${track.index + 1}`}</SelectItem>)}</SelectContent>
              </Select>
              {saveDefault("audio", "audio language")}
            </div>}
            {subtitles.length > 0 && <div className="grid gap-2">
              <Label htmlFor="playback-subtitles">Subtitles</Label>
              <Select value={String(subtitles.find(track => track.selected)?.index ?? -1)} disabled={disabled} onValueChange={value => selectTrack("subtitle", Number(value))}>
                <SelectTrigger id="playback-subtitles" className="min-h-11 w-full"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="-1" className="min-h-11">Off</SelectItem>{subtitles.map(track => <SelectItem key={track.id} value={String(track.index)} className="min-h-11">{track.label || track.language || `Subtitle ${track.index + 1}`}</SelectItem>)}</SelectContent>
              </Select>
              {saveDefault("subtitles", "subtitles")}
            </div>}
            {player.seekable && !entry?.live && <div className="grid gap-2">
              <Label htmlFor="playback-speed">Speed</Label>
              <Select value={String(player.speed ?? 1)} disabled={disabled} onValueChange={value => {
                if (player.playbackId) void run({ type: "speed", playbackId: player.playbackId, speed: Number(value) });
              }}>
                <SelectTrigger id="playback-speed" className="min-h-11 w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{[...new Set([0.5, 0.75, 1, 1.25, 1.5, 2, player.speed ?? 1])].sort((a, b) => a - b).map(speed => <SelectItem key={speed} value={String(speed)} className="min-h-11">{speed === 1 ? "Normal" : `${speed}×`}</SelectItem>)}</SelectContent>
              </Select>
              {saveDefault("speed", "speed")}
            </div>}
            {chapters.length > 0 && player.seekable && <div className="grid gap-2">
              <Label htmlFor="playback-chapters">Chapter</Label>
              <Select value={chapterIndex < 0 ? "" : String(chapterIndex)} disabled={disabled} onValueChange={value => {
                const chapter = chapters[Number(value)];
                if (chapter && player.playbackId) void run({ type: "seek", playbackId: player.playbackId, position: chapter.position });
              }}>
                <SelectTrigger id="playback-chapters" className="min-h-11 w-full"><SelectValue placeholder="Choose a chapter" /></SelectTrigger>
                <SelectContent>{chapters.map((chapter, index) => <SelectItem key={index} value={String(index)} className="min-h-11">{chapter.title || `Chapter ${index + 1}`}</SelectItem>)}</SelectContent>
              </Select>
            </div>}
            {player.replayGain !== undefined && <div className="grid gap-2">
              <Label htmlFor="playback-replaygain">Volume normalization</Label>
              <Select value={player.replayGain} disabled={disabled} onValueChange={mode => {
                if (player.playbackId) void run({ type: "replayGain", playbackId: player.playbackId, mode: mode as ReplayGainMode });
              }}>
                <SelectTrigger id="playback-replaygain" className="min-h-11 w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{["off", "track", "album"].map(mode => <SelectItem key={mode} value={mode} className="min-h-11">{mode[0]!.toUpperCase() + mode.slice(1)}</SelectItem>)}</SelectContent>
              </Select>
              {saveDefault("replayGain", "volume normalization")}
            </div>}
            {video ? <Collapsible key={player.playbackId} className="sm:col-span-2">
              <CollapsibleTrigger asChild><Button variant="ghost" className="min-h-11 px-0">Subtitles and timing</Button></CollapsibleTrigger>
              <CollapsibleContent className="grid gap-4 pt-3">
                <SubtitleUpload playbackId={player.playbackId} credentials={credentials} connected={connected} disabled={disabled} />
                {audio.length > 0 && <DelayControl id="playback-audio-delay" label="Host audio delay" value={player.audioDelay ?? 0} disabled={disabled} onApply={delay => player.playbackId ? run({ type: "audioDelay", playbackId: player.playbackId, delay }) : Promise.resolve(false)} />}
                {subtitles.length > 0 && <DelayControl id="playback-subtitle-delay" label="Subtitle delay" value={player.subtitleDelay ?? 0} disabled={disabled} onApply={delay => player.playbackId ? run({ type: "subtitleDelay", playbackId: player.playbackId, delay }) : Promise.resolve(false)} />}
              </CollapsibleContent>
            </Collapsible> : audio.length > 0 && <DelayControl key={player.playbackId} id="playback-audio-delay" label="Host audio delay" value={player.audioDelay ?? 0} disabled={disabled} onApply={delay => player.playbackId ? run({ type: "audioDelay", playbackId: player.playbackId, delay }) : Promise.resolve(false)} />}
            {pending && <p role="status" className="sm:col-span-2">Applying…</p>}
            {defaultError && <Alert variant="destructive" className="sm:col-span-2"><AlertDescription>{defaultError}</AlertDescription></Alert>}
            {player.subtitleError && <Alert variant="destructive" className="sm:col-span-2"><AlertDescription>{player.subtitleError}</AlertDescription></Alert>}
          </div>
          <DialogFooter><DialogClose asChild><Button className="min-h-11">Done</Button></DialogClose></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function PlaybackSettings(props: PlaybackSettingsProps) {
  return <PlaybackSettingsPanel {...props} panel="all" />;
}
