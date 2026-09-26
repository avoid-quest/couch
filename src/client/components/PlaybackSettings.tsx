import { usePlaybackClock } from "@/session/playback-clock";
import { Minus, Plus, Settings } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChoiceGroup } from "@/components/ChoiceGroup";
import { SettingsSection } from "@/components/SettingsRow";
import { DelayControl } from "@/components/DelayControl";
import type { WatchingProfile } from "../../shared/library";
import type { Action, PlaybackPreferences as Preferences, QueueEntry, ReplayGainMode } from "../../shared/protocol";
import type { ClientPlayerState, Credentials } from "@/session/session";
import { apiJson } from "@/api/client";
import { playbackDefault, type PlaybackDefaultSetting } from "../../shared/playback-default";
import { QualitySelect } from "@/components/QualitySelect";
import { supportsCurrentVideoQuality } from "../../shared/video-quality";
import { videoQualityLabels } from "@/video-quality";

export type PlaybackSettingsProps = {
  entry?: QueueEntry;
  player: ClientPlayerState;
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
    setError(previous ? "Playback changed. Choose the file again." : null);
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
      setError("Subtitle file is empty or over 2 MB.");
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    try {
      const query = new URLSearchParams({ playbackId, name: file.name });
      const result = await apiJson<{ ok?: boolean }>(credentials, `/api/subtitles?${query}`, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: file, signal: controller.signal });
      if (result.ok !== true) throw new Error("Couldn't add subtitles.");
      if (!controller.signal.aborted) setNotice("Subtitles added.");
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Couldn't add subtitles.");
    } finally {
      if (request.current === controller) {
        request.current = null;
        setPending(false);
      }
    }
  };

  return <div className="grid gap-2">
    {compact ? <Button variant="ghost" className="-mx-2.5 justify-start font-normal" disabled={disabled || pending || !playbackId} onClick={() => fileInput.current?.click()}><Plus aria-hidden="true" />Add subtitles</Button> : <Label htmlFor={id}>Add subtitles</Label>}
    <Input ref={fileInput} id={id} type="file" tabIndex={compact ? -1 : undefined} className={compact ? "hidden" : undefined} accept=".srt,.ass,.ssa,.vtt" disabled={disabled || pending || !playbackId} aria-describedby={compact ? undefined : `${id}-help`} onChange={event => {
      const file = event.currentTarget.files?.[0];
      event.currentTarget.value = "";
      if (file) void upload(file);
    }} />
    {!compact && <p id={`${id}-help`} className="text-sm text-muted-foreground">SRT, ASS, SSA or VTT, up to 2 MB.</p>}
    {pending && <p className="text-sm text-muted-foreground" role="status">Adding…</p>}
    {notice && <p className="text-sm" role="status">{notice}</p>}
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
  </div>;
}


function PanelStepper({ label, value, disabled, onStep }: { label: string; value: string; disabled: boolean; onStep: (direction: -1 | 1) => void }) {
  return <div className="flex items-center justify-between gap-2 border-b py-1">
    <span>{label}</span>
    <ButtonGroup aria-label={`${label} adjustment`}>
      <Button variant="ghost" size="icon" aria-label={`${label} earlier`} disabled={disabled} onClick={() => onStep(-1)}><Minus aria-hidden="true" /></Button>
      <span className="w-16 self-center text-center tabular-nums">{value}</span>
      <Button variant="ghost" size="icon" aria-label={`${label} later`} disabled={disabled} onClick={() => onStep(1)}><Plus aria-hidden="true" /></Button>
    </ButtonGroup>
  </div>;
}

const trackLabel = (track: { label?: string | null; language?: string | null; index: number }, kind: string) => track.label || track.language || `${kind} ${track.index + 1}`;
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

export function PlaybackSettingsPanel({ entry, player, ready, connected, credentials, preferences, profile, onCommand, panel }: PlaybackSettingsProps & { panel: "tracks" | "settings" | "all" }) {
  const playbackClock = usePlaybackClock();
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
  const chapterIndex = chapters.findLastIndex((chapter) => chapter.position <= playbackClock.position);
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
    return patch && !saved && <Button variant="ghost" className="-mx-2.5 justify-start text-muted-foreground" disabled={disabled} onClick={async () => {
      setDefaultError(null);
      if (player.playbackId && !await run({ type: "savePlaybackDefault", profileId: profile.id, playbackId: player.playbackId, setting })) setDefaultError("Couldn't save default.");
    }}>Save {label} as default</Button>;

  };

  const speeds = [...new Set([0.5, 0.75, 1, 1.25, 1.5, 2, player.speed ?? 1])].sort((a, b) => a - b);
  const idle = disabled || !player.playbackId;
  const messages = <>
    {pending && <p className="text-sm text-muted-foreground" role="status">Applying…</p>}
    {defaultError && <Alert variant="destructive"><AlertDescription>{defaultError}</AlertDescription></Alert>}
    {player.subtitleError && <Alert variant="destructive"><AlertDescription>{player.subtitleError}</AlertDescription></Alert>}
  </>;

  if (panel !== "all") {
    const seconds = (value: number) => `${value > 0 ? "+" : ""}${value.toFixed(1)} s`;
    const adjustDelay = (type: "audioDelay" | "subtitleDelay", value: number, direction: -1 | 1) => {
      if (player.playbackId) void run({ type, playbackId: player.playbackId, delay: Math.round((value + direction * 0.1) * 10) / 10 });
    };
    const none = <p className="text-sm text-muted-foreground">None</p>;
    return <div className="grid gap-8 pt-4">
      {panel === "tracks" ? <>
        <SettingsSection title="Subtitles">
          {subtitles.length ? <ChoiceGroup label="Subtitles" orientation="vertical" disabled={disabled} value={String(subtitles.find(track => track.selected)?.index ?? -1)} onValueChange={value => selectTrack("subtitle", Number(value))}
            options={[{ value: "-1", label: "Off" }, ...subtitles.map(track => ({ value: String(track.index), label: trackLabel(track, "Subtitle") }))]} /> : none}
          <SubtitleUpload playbackId={player.playbackId} credentials={credentials} connected={connected} disabled={disabled} compact />
          {saveDefault("subtitles", "subtitles")}
        </SettingsSection>
        <SettingsSection title="Audio">
          {audio.length ? <ChoiceGroup label="Audio" orientation="vertical" disabled={disabled} value={String(audio.find(track => track.selected)?.index ?? "")} onValueChange={value => selectTrack("audio", Number(value))}
            options={audio.map(track => ({ value: String(track.index), label: trackLabel(track, "Audio") }))} /> : none}
          {saveDefault("audio", "audio language")}
        </SettingsSection>
        <SettingsSection title="Delay"><PanelStepper label="Subtitle delay" value={seconds(player.subtitleDelay ?? 0)} disabled={idle} onStep={direction => adjustDelay("subtitleDelay", player.subtitleDelay ?? 0, direction)} /></SettingsSection>
      </> : <>
        {chapters.length > 0 && player.seekable && <SettingsSection title="Chapters"><ChoiceGroup label="Chapters" orientation="vertical" disabled={idle} value={String(chapterIndex)} onValueChange={value => { const chapter = chapters[Number(value)]; if (chapter && player.playbackId) void run({ type: "seek", playbackId: player.playbackId, position: chapter.position }); }}
          options={chapters.map((chapter, index) => ({ value: String(index), label: <span className="truncate">{chapter.title || `Chapter ${index + 1}`}</span>, count: clock(chapter.position) }))} /></SettingsSection>}
        {player.seekable && !entry?.live && <SettingsSection title="Speed"><ChoiceGroup label="Speed" disabled={idle} value={String(player.speed ?? 1)} onValueChange={value => { if (player.playbackId) void run({ type: "speed", playbackId: player.playbackId, speed: Number(value) }); }}
          options={speeds.map(speed => ({ value: String(speed), label: `${speed}×` }))} />{saveDefault("speed", "speed")}</SettingsSection>}
        {showQuality && <SettingsSection title="Quality"><ChoiceGroup label="Quality" orientation="vertical" disabled={idle || !qualityAvailable} value={entry?.quality ?? "auto"} onValueChange={quality => { if (player.playbackId) void run({ type: "videoQuality", playbackId: player.playbackId, quality }); }}
          options={(Object.entries(videoQualityLabels) as [NonNullable<QueueEntry["quality"]>, string][]).map(([value, label]) => ({ value, label }))} /></SettingsSection>}
        {player.replayGain !== undefined && <SettingsSection title="Volume leveling"><ChoiceGroup label="Volume leveling" orientation="vertical" disabled={idle} value={player.replayGain} onValueChange={mode => { if (player.playbackId) void run({ type: "replayGain", playbackId: player.playbackId, mode }); }}
          options={(["off", "track", "album"] as ReplayGainMode[]).map(mode => ({ value: mode, label: mode[0]!.toUpperCase() + mode.slice(1) }))} />
          {saveDefault("replayGain", "volume leveling")}</SettingsSection>}
        <SettingsSection title="Sound">
          <PanelStepper label="Audio delay" value={seconds(player.audioDelay ?? 0)} disabled={idle} onStep={direction => adjustDelay("audioDelay", player.audioDelay ?? 0, direction)} />
        </SettingsSection>
      </>}
      {messages}
    </div>;
  }

  const select = (id: string, label: string, value: string, onChange: (value: string) => void, options: { value: string; label: string }[], placeholder?: string) => <div className="grid gap-2">
    <Label htmlFor={id}>{label}</Label>
    <Select value={value} disabled={disabled} onValueChange={onChange}>
      <SelectTrigger id={id} className="w-full"><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>{options.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
    </Select>
  </div>;
  const audioDelay = <DelayControl key={player.playbackId} id="playback-audio-delay" label="Audio delay" value={player.audioDelay ?? 0} disabled={disabled} onApply={delay => player.playbackId ? run({ type: "audioDelay", playbackId: player.playbackId, delay }) : Promise.resolve(false)} />;
  return (
    <Dialog onOpenChange={open => { if (!open) focusRequest.current?.cancel(); }}>
      <DialogTrigger asChild><Button variant="ghost" size="icon-lg" aria-label="Playback settings" title="Playback settings"><Settings aria-hidden="true" /></Button></DialogTrigger>
      <DialogContent className="sm:max-w-2xl" aria-describedby={undefined}>
        <DialogHeader><DialogTitle>Playback settings</DialogTitle></DialogHeader>
        <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
          {showQuality && <QualitySelect id="playback-quality" label="Quality" value={entry?.quality ?? "auto"} disabled={disabled || !qualityAvailable} onChange={quality => {
            setDefaultError(null);
            if (player.playbackId) void run({ type: "videoQuality", playbackId: player.playbackId, quality }, "playback-quality").then(ok => { if (!ok) setDefaultError("Couldn't change quality."); });
          }} />}
          {audio.length > 1 && <div className="grid gap-2">{select("playback-audio", "Audio", String(audio.find(track => track.selected)?.index ?? ""), value => selectTrack("audio", Number(value)), audio.map(track => ({ value: String(track.index), label: trackLabel(track, "Audio") })), "Audio")}{saveDefault("audio", "audio language")}</div>}
          {subtitles.length > 0 && <div className="grid gap-2">{select("playback-subtitles", "Subtitles", String(subtitles.find(track => track.selected)?.index ?? -1), value => selectTrack("subtitle", Number(value)), [{ value: "-1", label: "Off" }, ...subtitles.map(track => ({ value: String(track.index), label: trackLabel(track, "Subtitle") }))])}{saveDefault("subtitles", "subtitles")}</div>}
          {player.seekable && !entry?.live && <div className="grid gap-2">{select("playback-speed", "Speed", String(player.speed ?? 1), value => { if (player.playbackId) void run({ type: "speed", playbackId: player.playbackId, speed: Number(value) }); }, speeds.map(speed => ({ value: String(speed), label: speed === 1 ? "Normal" : `${speed}×` })))}{saveDefault("speed", "speed")}</div>}
          {chapters.length > 0 && player.seekable && select("playback-chapters", "Chapter", chapterIndex < 0 ? "" : String(chapterIndex), value => { const chapter = chapters[Number(value)]; if (chapter && player.playbackId) void run({ type: "seek", playbackId: player.playbackId, position: chapter.position }); }, chapters.map((chapter, index) => ({ value: String(index), label: chapter.title || `Chapter ${index + 1}` })), "Chapter")}
          {player.replayGain !== undefined && <div className="grid gap-2">{select("playback-replaygain", "Volume leveling", player.replayGain, mode => { if (player.playbackId) void run({ type: "replayGain", playbackId: player.playbackId, mode: mode as ReplayGainMode }); }, ["off", "track", "album"].map(mode => ({ value: mode, label: mode[0]!.toUpperCase() + mode.slice(1) })))}{saveDefault("replayGain", "volume leveling")}</div>}
          {video ? <Collapsible key={player.playbackId} className="sm:col-span-2">
            <CollapsibleTrigger asChild><Button variant="ghost" className="-mx-2.5">More</Button></CollapsibleTrigger>
            <CollapsibleContent className="grid gap-4 pt-3">
              <SubtitleUpload playbackId={player.playbackId} credentials={credentials} connected={connected} disabled={disabled} />
              {audio.length > 0 && audioDelay}
              {subtitles.length > 0 && <DelayControl id="playback-subtitle-delay" label="Subtitle delay" value={player.subtitleDelay ?? 0} disabled={disabled} onApply={delay => player.playbackId ? run({ type: "subtitleDelay", playbackId: player.playbackId, delay }) : Promise.resolve(false)} />}
            </CollapsibleContent>
          </Collapsible> : audio.length > 0 && audioDelay}
          <div className="grid gap-2 sm:col-span-2">{messages}</div>
        </div>
        <DialogFooter><DialogClose asChild><Button>Done</Button></DialogClose></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PlaybackSettings(props: PlaybackSettingsProps) {
  return <PlaybackSettingsPanel {...props} panel="all" />;
}
