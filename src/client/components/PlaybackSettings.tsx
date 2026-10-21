import { usePlaybackClock } from "@/session/playback-clock";
import { ChevronLeft, ChevronRight, Minus, Plus } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Input } from "@/components/ui/input";
import { PopoverContent } from "@/components/ui/popover";
import { ChoiceGroup } from "@/components/ChoiceGroup";
import type { WatchingProfile } from "../../shared/viewing";
import type { Action, PlaybackPreferences as Preferences, QueueEntry } from "../../shared/protocol";
import type { ClientPlayerState, Credentials } from "@/session/session";
import { apiJson } from "@/api/client";
import { playbackDefault, type PlaybackDefaultSetting } from "../../shared/playback-default";
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

function SubtitleUpload({ playbackId, credentials, connected, disabled }: { playbackId: string | null; credentials: Credentials; connected: boolean; disabled: boolean }) {
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
    if (!/\.(srt|vtt)$/i.test(file.name)) {
      setError("Choose an SRT or VTT subtitle file.");
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
    <Button variant="ghost" className="-mx-2.5 justify-start font-normal" disabled={disabled || pending || !playbackId} onClick={() => fileInput.current?.click()}><Plus aria-hidden="true" />Add subtitles</Button>
    <Input ref={fileInput} id={id} type="file" tabIndex={-1} className="hidden" accept=".srt,.vtt" disabled={disabled || pending || !playbackId} onChange={event => {
      const file = event.currentTarget.files?.[0];
      event.currentTarget.value = "";
      if (file) void upload(file);
    }} />
    {pending && <p className="text-sm text-muted-foreground" role="status">Adding…</p>}
    {notice && <p className="text-sm" role="status">{notice}</p>}
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
  </div>;
}

function Stepper({ label, value, disabled, onStep }: { label: string; value: string; disabled: boolean; onStep: (direction: -1 | 1) => void }) {
  return <div className="flex items-center justify-between gap-2">
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
const seconds = (value: number) => `${value > 0 ? "+" : ""}${value.toFixed(1)} s`;
const speedLabel = (speed: number) => `${speed}×`;

/** What both player menus share: one command at a time, focus kept on the control that sent it, and Save as default. */
function usePlaybackCommands({ entry, player, ready, connected, credentials, preferences, profile, onCommand }: PlaybackSettingsProps) {
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
  const disabled = !ready || pending;
  const run = async (action: Action) => {
    if (commandPending.current) return false;
    commandPending.current = true;
    // A pressed choice is disabled while its command runs; focus returns to it rather than dropping out (#644 ticket 12).
    const trigger = document.activeElement instanceof HTMLButtonElement ? document.activeElement : null;
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
  const command = (action: (playbackId: string) => Action) => { if (player.playbackId) void run(action(player.playbackId)); };
  const saveDefault = (setting: PlaybackDefaultSetting, label: string) => {
    const patch = playbackDefault(player, setting);
    const saved = patch && Object.entries(patch).every(([key, value]) => preferences.profile[key as keyof typeof preferences.profile] === value);
    return patch && !saved && <Button variant="ghost" className="-mx-2.5 justify-start text-muted-foreground" disabled={disabled} onClick={async () => {
      setDefaultError(null);
      if (player.playbackId && !await run({ type: "savePlaybackDefault", profileId: profile.id, playbackId: player.playbackId, setting })) setDefaultError("Couldn't save default.");
    }}>Save {label} as default</Button>;
  };
  const messages = (pending || defaultError || player.subtitleError) && <div className="grid gap-2 pt-2">
    {pending && <p className="text-sm text-muted-foreground" role="status">Applying…</p>}
    {defaultError && <Alert variant="destructive"><AlertDescription>{defaultError}</AlertDescription></Alert>}
    {player.subtitleError && <Alert variant="destructive"><AlertDescription>{player.subtitleError}</AlertDescription></Alert>}
  </div>;
  return { disabled, idle: disabled || !player.playbackId, command, saveDefault, messages };
}

type View = "subtitles" | "audio" | "speed" | "quality" | "chapters" | "audioDelay";
const viewTitles: Record<View, string> = { subtitles: "Subtitles", audio: "Audio", speed: "Speed", quality: "Quality", chapters: "Chapters", audioDelay: "Audio delay" };
const row = "h-11 w-full justify-start gap-3 rounded-none px-3 font-normal";

/**
 * The gear's menu, as YouTube's: a small menu over the picture, each row its setting and current value, and a submenu
 * that replaces it in place under a Back row. Subtitles and Audio lead it, as YouTube's Subtitles/CC and Audio track
 * rows; Details ends it. It is the Popover's content; the player owns the Popover and its trigger, at the top line's
 * right, so it opens downward and keeps `clearBottom` px (the band) free. `tracks` is false where there is no picture
 * (audio), so Subtitles and Audio stay out.
 */
export function PlaybackMenu({ details, tracks: showTracks = true, clearBottom = 0, ...props }: PlaybackSettingsProps & { details?: ReactNode; tracks?: boolean; clearBottom?: number }) {
  const { entry, player, credentials, connected } = props;
  const playbackClock = usePlaybackClock();
  const { disabled, idle, command, saveDefault, messages } = usePlaybackCommands(props);
  const [view, setView] = useState<View | null>(null);
  const content = useRef<HTMLDivElement>(null);
  const opener = useRef<View | null>(null);
  // A submenu lands on its chosen value, as a menu's open state does; Back lands on the row that opened it.
  useEffect(() => {
    const menu = content.current;
    if (!menu || !opener.current) return;
    (view ? menu.querySelector<HTMLElement>('[data-view-body] [data-state="on"]') ?? menu.querySelector<HTMLElement>("[data-view-body] button:not(:disabled)") : menu.querySelector<HTMLElement>(`[data-view="${opener.current}"]`))?.focus({ preventScroll: true });
  }, [view]);
  const tracks = player.tracks ?? [];
  const audio = tracks.filter(track => track.kind === "audio");
  const subtitles = tracks.filter(track => track.kind === "subtitle");
  const subtitle = subtitles.find(track => track.selected);
  const audioTrack = audio.find(track => track.selected);
  const select = (kind: "audio" | "subtitle", index: number) => command(playbackId => ({ type: "track", playbackId, kind, index }));
  const chapters = player.chapters ?? [];
  const chapterIndex = chapters.findLastIndex(chapter => chapter.position <= playbackClock.position);
  const qualityAvailable = supportsCurrentVideoQuality(entry, player);
  const speeds = [...new Set([0.5, 0.75, 1, 1.25, 1.5, 2, player.speed ?? 1])].sort((a, b) => a - b);
  // Audio is a choice only with more than one track, as YouTube's Audio track row.
  const rows: { view: View; value: string }[] = [
    ...(showTracks ? [{ view: "subtitles" as const, value: subtitle ? trackLabel(subtitle, "Subtitle") : "Off" }] : []),
    ...(showTracks && audio.length > 1 ? [{ view: "audio" as const, value: audioTrack ? trackLabel(audioTrack, "Audio") : "" }] : []),
    ...(player.seekable && !entry?.live ? [{ view: "speed" as const, value: speedLabel(player.speed ?? 1) }] : []),
    ...(qualityAvailable ? [{ view: "quality" as const, value: videoQualityLabels[entry?.quality ?? "auto"] }] : []),
    ...(chapters.length > 0 && player.seekable ? [{ view: "chapters" as const, value: chapters[chapterIndex]?.title || (chapterIndex >= 0 ? `Chapter ${chapterIndex + 1}` : "") }] : []),
    ...(player.audioDelay !== undefined ? [{ view: "audioDelay" as const, value: seconds(player.audioDelay ?? 0) }] : []),
  ];
  const body = view === "subtitles" ? <>
    {subtitles.length ? <ChoiceGroup label="Subtitles" orientation="vertical" disabled={disabled} value={String(subtitle?.index ?? -1)} onValueChange={value => select("subtitle", Number(value))}
      options={[{ value: "-1", label: "Off" }, ...subtitles.map(track => ({ value: String(track.index), label: <span className="truncate">{trackLabel(track, "Subtitle")}</span> }))]} /> : <p className="py-2 text-muted-foreground">None in this video</p>}
    {subtitles.length > 0 && saveDefault("subtitles", "subtitles")}
    <div className="-mx-3 grid gap-2 border-t px-3 pt-2">
      <SubtitleUpload playbackId={player.playbackId} credentials={credentials} connected={connected} disabled={disabled} />
      <Stepper label="Subtitle delay" value={seconds(player.subtitleDelay ?? 0)} disabled={idle} onStep={direction => command(playbackId => ({ type: "subtitleDelay", playbackId, delay: Math.round(((player.subtitleDelay ?? 0) + direction * 0.1) * 10) / 10 }))} />
    </div>
  </> : view === "audio" ? <>
    <ChoiceGroup label="Audio" orientation="vertical" disabled={disabled} value={String(audioTrack?.index ?? "")} onValueChange={value => select("audio", Number(value))}
      options={audio.map(track => ({ value: String(track.index), label: <span className="truncate">{trackLabel(track, "Audio")}</span> }))} />
    {saveDefault("audio", "audio language")}
  </> : view === "speed" ? <>
    <ChoiceGroup label="Speed" orientation="vertical" disabled={idle} value={String(player.speed ?? 1)} onValueChange={value => command(playbackId => ({ type: "speed", playbackId, speed: Number(value) }))}
      options={speeds.map(speed => ({ value: String(speed), label: speedLabel(speed) }))} />
    {saveDefault("speed", "speed")}
  </> : view === "quality" ? <ChoiceGroup label="Quality" orientation="vertical" disabled={idle || !qualityAvailable} value={entry?.quality ?? "auto"} onValueChange={quality => command(playbackId => ({ type: "videoQuality", playbackId, quality }))}
    options={(Object.entries(videoQualityLabels) as [NonNullable<QueueEntry["quality"]>, string][]).map(([value, label]) => ({ value, label }))} />
  : view === "chapters" ? <ChoiceGroup label="Chapters" orientation="vertical" disabled={idle} value={String(chapterIndex)} onValueChange={value => { const chapter = chapters[Number(value)]; if (chapter) command(playbackId => ({ type: "seek", playbackId, position: chapter.position })); }}
    options={chapters.map((chapter, index) => ({ value: String(index), label: <span className="truncate">{chapter.title || `Chapter ${index + 1}`}</span>, count: clock(chapter.position) }))} />
  : view === "audioDelay" ? <Stepper label="Audio delay" value={seconds(player.audioDelay ?? 0)} disabled={idle} onStep={direction => command(playbackId => ({ type: "audioDelay", playbackId, delay: Math.round(((player.audioDelay ?? 0) + direction * 0.1) * 10) / 10 }))} />
  : null;
  // The Back row stays while a long list (subtitle languages, chapters) scrolls under it.
  return <PopoverContent ref={content} data-player-menu side="bottom" align="end" sideOffset={8} collisionPadding={{ top: 16, right: 16, left: 16, bottom: clearBottom + 8 }} aria-label={view ? viewTitles[view] : "Playback"}
    className="max-h-[calc(var(--radix-popover-content-available-height)-1rem)] w-72 gap-0 overflow-hidden p-0"
    // Back in a submenu returns to the menu, as on YouTube and a TV's own menus; Back on the menu closes it.
    onEscapeKeyDown={event => { if (view) { event.preventDefault(); setView(null); } }}>
    {view ? <>
      <div className="flex shrink-0 items-center gap-1 border-b px-1 py-1"><Button variant="ghost" size="icon" aria-label="Back to Playback" title="Back to Playback" onClick={() => setView(null)}><ChevronLeft aria-hidden="true" /></Button><h2 className="text-sm font-medium">{viewTitles[view]}</h2></div>
      <div data-view-body className="grid min-h-0 gap-2 overflow-y-auto overscroll-contain px-3 py-2">{body}{messages}</div>
    </> : <div className="min-h-0 overflow-y-auto py-1">
      {rows.map(item => <Button key={item.view} data-view={item.view} variant="ghost" className={row} onClick={() => { opener.current = item.view; setView(item.view); }}>
        {viewTitles[item.view]}<span className="ml-auto min-w-0 truncate text-muted-foreground">{item.value}</span><ChevronRight aria-hidden="true" className="-mr-1" />
      </Button>)}
      {details}
    </div>}
  </PopoverContent>;
}

export const playbackMenuRow = row;
