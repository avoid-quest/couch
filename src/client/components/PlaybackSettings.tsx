import { Settings } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { WatchingProfile } from "../../shared/library";
import type { Action, PlaybackPreferences as Preferences, PlayerState, QueueEntry, ReplayGainMode } from "../../shared/protocol";
import type { Credentials } from "@/session/session";
import { playbackDefault, type PlaybackDefaultSetting } from "../../shared/playback-default";
import { QualitySelect } from "@/components/QualitySelect";
import { supportsCurrentVideoQuality } from "../../shared/video-quality";

type Props = {
  entry?: QueueEntry;
  player: PlayerState;
  ready: boolean;
  connected: boolean;
  credentials: Credentials;
  preferences: Preferences;
  profile: WatchingProfile;
  onCommand: (action: Action) => Promise<boolean>;
};

function SubtitleUpload({ playbackId, credentials, connected, disabled }: {
  playbackId: string | null;
  credentials: Credentials;
  connected: boolean;
  disabled: boolean;
}) {
  const request = useRef<AbortController | null>(null);
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
      if (!controller.signal.aborted) setNotice("Subtitle sent. The Subtitles list shows the TV's current selection.");
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
    <Label htmlFor="playback-subtitle-file">Add subtitle file</Label>
    <Input id="playback-subtitle-file" type="file" className="min-h-11" accept=".srt,.ass,.ssa,.vtt" disabled={disabled || pending || !playbackId} aria-describedby="playback-subtitle-file-help" onChange={event => {
      const file = event.currentTarget.files?.[0];
      event.currentTarget.value = "";
      if (file) void upload(file);
    }} />
    <p id="playback-subtitle-file-help" className="text-sm text-muted-foreground">SRT, ASS, SSA or VTT, up to 2 MiB.</p>
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

export function PlaybackSettings({ entry, player, ready, connected, credentials, preferences, profile, onCommand }: Props) {
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

  return (
    <div className="playback-settings">
      <Dialog onOpenChange={open => { if (!open) focusRequest.current?.cancel(); }}>
        <DialogTrigger asChild><Button variant="ghost" size="icon" className="icon-button min-h-11 min-w-11" aria-label="Playback settings" title="Playback settings"><Settings aria-hidden="true" /></Button></DialogTrigger>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Playback settings</DialogTitle>
            <DialogDescription className="sr-only">Controls for the current media.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-5">
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
            {video ? <details key={player.playbackId}>
              <summary tabIndex={0} className="min-h-11 cursor-pointer content-center">Subtitles and timing</summary>
              <div className="grid gap-4 pt-3">
                <SubtitleUpload playbackId={player.playbackId} credentials={credentials} connected={connected} disabled={disabled} />
                {audio.length > 0 && <DelayControl id="playback-audio-delay" label="TV audio delay" value={player.audioDelay ?? 0} disabled={disabled} onApply={delay => player.playbackId ? run({ type: "audioDelay", playbackId: player.playbackId, delay }) : Promise.resolve(false)} />}
                {subtitles.length > 0 && <DelayControl id="playback-subtitle-delay" label="Subtitle delay" value={player.subtitleDelay ?? 0} disabled={disabled} onApply={delay => player.playbackId ? run({ type: "subtitleDelay", playbackId: player.playbackId, delay }) : Promise.resolve(false)} />}
              </div>
            </details> : audio.length > 0 && <DelayControl key={player.playbackId} id="playback-audio-delay" label="TV audio delay" value={player.audioDelay ?? 0} disabled={disabled} onApply={delay => player.playbackId ? run({ type: "audioDelay", playbackId: player.playbackId, delay }) : Promise.resolve(false)} />}
            {pending && <p role="status">Applying…</p>}
            {defaultError && <Alert variant="destructive"><AlertDescription>{defaultError}</AlertDescription></Alert>}
            {player.subtitleError && <Alert variant="destructive"><AlertDescription>{player.subtitleError}</AlertDescription></Alert>}
          </div>
          <DialogFooter><DialogClose asChild><Button className="min-h-11">Done</Button></DialogClose></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
