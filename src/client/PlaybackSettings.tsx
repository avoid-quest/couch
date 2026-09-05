import { useEffect, useRef, useState, type FormEvent } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { WatchingProfile } from "../shared/library";
import type { Action, PlaybackPreferences as Preferences, PlayerState } from "../shared/protocol";
import type { Credentials } from "./session";
import { PlaybackPreferences } from "./PlaybackPreferences";

type Props = {
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
    <p id="playback-subtitle-file-help" className="text-sm text-muted-foreground">Choose from this device. SRT, ASS, SSA or VTT, up to 2 MiB. Added subtitles apply to this playback only.</p>
    {pending && <p className="text-sm text-muted-foreground" role="status">Sending subtitle…</p>}
    {notice && <p className="text-sm text-primary" role="status">{notice}</p>}
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
  </div>;
}

function DelayControl({ id, label, value, disabled, onApply }: {
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

export function PlaybackSettings({ player, ready, connected, credentials, preferences, profile, onCommand }: Props) {
  const [pending, setPending] = useState(false);
  const commandPending = useRef(false);
  const tracks = player.tracks ?? [];
  const audio = tracks.filter((track) => track.kind === "audio");
  const subtitles = tracks.filter((track) => track.kind === "subtitle");
  const chapters = player.chapters ?? [];
  const chapterIndex = chapters.findLastIndex((chapter) => chapter.position <= player.position);
  const disabled = !ready || pending;
  const run = async (action: Action) => {
    if (commandPending.current) return false;
    commandPending.current = true;
    const listbox = document.activeElement?.closest('[role="listbox"]');
    const trigger = listbox?.id ? document.querySelector<HTMLButtonElement>(`[role="combobox"][aria-controls="${CSS.escape(listbox.id)}"]`) : null;
    let navigated = false;
    const cancelFocus = () => { navigated = true; };
    if (trigger) {
      document.addEventListener("keydown", cancelFocus, true);
      document.addEventListener("pointerdown", cancelFocus, true);
    }
    setPending(true);
    try {
      return await onCommand(action);
    } finally {
      commandPending.current = false;
      setPending(false);
      if (trigger) requestAnimationFrame(() => {
        document.removeEventListener("keydown", cancelFocus, true);
        document.removeEventListener("pointerdown", cancelFocus, true);
        // Radix cannot restore focus to the trigger while a command disables it.
        if (!navigated && trigger.isConnected && !trigger.disabled && trigger.getClientRects().length) trigger.focus({ preventScroll: true });
      });
    }
  };
  const selectTrack = (kind: "audio" | "subtitle", index: number) => {
    if (player.playbackId) void run({ type: "track", playbackId: player.playbackId, kind, index });
  };

  return (
    <div className="playback-settings">
      <Dialog>
        <DialogTrigger asChild><Button variant="outline" className="min-h-11">Playback settings</Button></DialogTrigger>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Playback settings</DialogTitle>
            <DialogDescription>Audio, subtitles and timing for the TV. Changes appear on every paired remote.</DialogDescription>
          </DialogHeader>
          <Tabs defaultValue="current">
            <TabsList className="w-full" aria-label="Playback settings sections">
              <TabsTrigger value="current">Current playback</TabsTrigger>
              <TabsTrigger value="preferences">Saved preferences</TabsTrigger>
            </TabsList>
            <TabsContent value="current" className="grid gap-4 pt-2">
                <div className="grid gap-5 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <Label htmlFor="playback-audio">Audio track</Label>
                    <Select value={String(audio.find((track) => track.selected)?.index ?? "")} disabled={disabled || !audio.length} onValueChange={(value) => selectTrack("audio", Number(value))}>
                      <SelectTrigger id="playback-audio" className="min-h-11 w-full"><SelectValue placeholder={audio.length ? "Choose audio" : "No audio tracks"} /></SelectTrigger>
                      <SelectContent>{audio.map((track) => <SelectItem key={track.id} value={String(track.index)} className="min-h-11">{track.label || track.language || `Audio ${track.index + 1}`}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="playback-subtitles">Subtitles</Label>
                    <Select value={String(subtitles.find((track) => track.selected)?.index ?? -1)} disabled={disabled || !subtitles.length} onValueChange={(value) => selectTrack("subtitle", Number(value))}>
                      <SelectTrigger id="playback-subtitles" className="min-h-11 w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="-1" className="min-h-11">Off</SelectItem>
                        {subtitles.map((track) => <SelectItem key={track.id} value={String(track.index)} className="min-h-11">{track.label || track.language || `Subtitle ${track.index + 1}`}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="playback-chapters">Chapter</Label>
                    <Select value={chapterIndex < 0 ? "" : String(chapterIndex)} disabled={disabled || !player.seekable || !chapters.length} onValueChange={(value) => {
                      const chapter = chapters[Number(value)];
                      if (chapter && player.playbackId) void run({ type: "seek", playbackId: player.playbackId, position: chapter.position });
                    }}>
                      <SelectTrigger id="playback-chapters" className="min-h-11 w-full"><SelectValue placeholder={chapters.length ? "Choose a chapter" : "No chapters"} /></SelectTrigger>
                      <SelectContent>{chapters.map((chapter, index) => <SelectItem key={index} value={String(index)} className="min-h-11">{chapter.title || `Chapter ${index + 1}`}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="playback-speed">Playback speed</Label>
                    <Select value={String(player.speed ?? 1)} disabled={disabled} onValueChange={(value) => {
                      if (player.playbackId) void run({ type: "speed", playbackId: player.playbackId, speed: Number(value) });
                    }}>
                      <SelectTrigger id="playback-speed" className="min-h-11 w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>{[0.5, 0.75, 1, 1.25, 1.5, 2].map((speed) => <SelectItem key={speed} value={String(speed)} className="min-h-11">{speed === 1 ? "Normal" : `${speed}×`}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>
                <SubtitleUpload playbackId={player.playbackId} credentials={credentials} connected={connected} disabled={disabled} />
                {player.subtitleError && <Alert variant="destructive"><AlertDescription>{player.subtitleError}</AlertDescription></Alert>}
                <Separator />
                <div className="grid gap-5 sm:grid-cols-2" key={player.playbackId}>
                  <DelayControl id="playback-audio-delay" label="Audio delay" value={player.audioDelay ?? 0} disabled={disabled || !audio.length} onApply={(delay) => player.playbackId ? run({ type: "audioDelay", playbackId: player.playbackId, delay }) : Promise.resolve(false)} />
                  <DelayControl id="playback-subtitle-delay" label="Subtitle delay" value={player.subtitleDelay ?? 0} disabled={disabled || !subtitles.length} onApply={(delay) => player.playbackId ? run({ type: "subtitleDelay", playbackId: player.playbackId, delay }) : Promise.resolve(false)} />
                </div>
                <p className="text-muted-foreground text-sm">Positive delay plays audio or shows subtitles later. Speed is saved for {profile.name}; audio delay is saved for this TV. Subtitle delay applies to this item only.</p>
            </TabsContent>
            <TabsContent value="preferences" className="pt-2">
              <PlaybackPreferences key={profile.id} profile={profile} preferences={preferences} connected={connected} onCommand={onCommand} />
            </TabsContent>
          </Tabs>
          <DialogFooter><DialogClose asChild><Button className="min-h-11">Done</Button></DialogClose></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
