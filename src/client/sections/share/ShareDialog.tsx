import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { ChoiceGroup } from "@/components/ChoiceGroup";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { deviceId } from "@/session/device-id";
import { couchApp } from "@/session/native-context";
import { errorText, useSessionGate } from "@/session/session-context";
import { isDesktop, subscribeDesktop } from "@/sections/shell/Outputs";
import { LiveSettingsStatus, PlaybackBufferInput, useLiveAudioSettings } from "./LiveOperator";
import { qualityLabels, selectionOf, shareKinds, shareTargets, unavailable, type ShareKind } from "./share";
import type { CaptureSource } from "../../../shared/capture";
import type { LiveVideoQuality } from "../../../shared/live-input";

// A chip: a quiet capsule that steps up under the pointer, the chosen one checked (Search's kinds do the same).
export const chip = "h-control flex-none gap-1.5 rounded-full bg-secondary px-3.5 font-normal hover:bg-fill-hover data-[state=on]:bg-secondary touch:h-11";

/** One label beside its control, on a divided row. */
function Row({ label, htmlFor, description, children }: { label: string; htmlFor?: string; description?: string; children: ReactNode }) {
  return <div className="flex min-h-control flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t py-3">
    <div className="grid gap-0.5"><label htmlFor={htmlFor} className="text-body">{label}</label>{description && <p className="text-meta text-muted-foreground">{description}</p>}</div>
    {children}
  </div>;
}

/**
 * Share screen or sound (docs/design/share.md): what to share, the screens or windows as pictures, the input, Play on,
 * this computer's sound and the picture's quality, then Start sharing, which starts the capture and plays it on the
 * chosen devices. A Dialog on desktop, a bottom Sheet on phones and the TV.
 */
export function ShareDialog({ open, onOpenChange, tv, trigger }: { open: boolean; onOpenChange: (open: boolean) => void; tv: boolean; trigger?: ReactNode }) {
  const desktop = useSyncExternalStore(subscribeDesktop, isDesktop, () => false);
  const title = "Share this device";
  // Its choices reset each time it opens, and capture is asked for only from the device in hand.
  const body = open && <ShareForm onDone={() => onOpenChange(false)} />;
  if (desktop && !tv) return <Dialog open={open} onOpenChange={onOpenChange}>
    {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
    <DialogContent data-tv-local-only aria-describedby={undefined} className="gap-0 sm:max-w-2xl"><DialogTitle className="mb-5 font-display text-heading">{title}</DialogTitle>{body}</DialogContent>
  </Dialog>;
  return <Sheet open={open} onOpenChange={onOpenChange}>
    {trigger && <SheetTrigger asChild>{trigger}</SheetTrigger>}
    <SheetContent data-tv-local-only side="bottom" aria-describedby={undefined} className="max-h-[90dvh] items-center overflow-y-auto px-(--gutter) pt-6 pb-8">
      <div className="grid w-full max-w-2xl"><SheetTitle className="mb-5 font-display text-heading">{title}</SheetTitle>{body}</div>
    </SheetContent>
  </Sheet>;
}

function ShareForm({ onDone }: { onDone: () => void }) {
  const { state, connected, localHost, startLive, endLive, liveAudioInputs, liveSharing, run, command, setError: report } = useSessionGate();
  const navigate = useNavigate();
  const here = deviceId();
  const kinds = shareKinds.filter(kind => !kind.intent);
  const browser = { media: !!navigator.mediaDevices?.getUserMedia, display: !!navigator.mediaDevices?.getDisplayMedia };
  const [kind, setKind] = useState<ShareKind>(() => kinds.find(item => !unavailable(item, browser)) ?? kinds[0]!);
  const live = useLiveAudioSettings(kind.intent === "live");
  const [sources, setSources] = useState<CaptureSource[] | null>(null);
  const [sourceId, setSourceId] = useState("");
  const [inputs, setInputs] = useState<import("../../../shared/capture").AudioInput[] | null>(null);
  const [audioDeviceId, setAudioDeviceId] = useState("default");
  useEffect(() => { setInputs(null); setAudioDeviceId(kind.intent === "live" ? "" : "default"); }, [kind.id]);
  const [targets, setTargets] = useState<string[]>([]);
  const [sound, setSound] = useState(true);
  const [quality, setQuality] = useState<LiveVideoQuality>("1080p");
  const [pending, setPending] = useState(false);
  const [listing, setListing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // What to turn on in the system's settings, once capturing failed without it, for the kind it failed on.
  const [blocked, setBlocked] = useState<{ kind: string; text: string } | null>(null);
  const reason = unavailable(kind, browser);
  const lists = !!couchApp?.captureSources && kind.capture !== "microphone";
  const pictures = kind.pictures && sources?.filter(source => source.kind === kind.pictures);
  const source = pictures?.find(item => item.id === sourceId);
  const devices = shareTargets(state, here);
  // Another window of this device already shares; Core keeps one source per capturing window.
  const elsewhere = state?.liveSources?.find(item => item.deviceId === here);
  const available = connected && !pending && !listing;
  // A device that keeps its screen to itself still takes the sound, and one that keeps both can't take this.
  const takes = (device: (typeof devices)[number]) => kind.pictures ? device.sharing?.video || device.sharing?.audio && sound : device.sharing?.audio;
  // A chosen device that the kind or sound no longer suits drops out of the choice.
  const chosen = devices.filter(device => targets.includes(device.id) && takes(device));
  // Closing the dialog while the capture or the input probe starts cancels it, as Cancel does. Once published, the
  // header's capsule takes Share's place and unmounts the dialog itself, which ends nothing.
  const starting = useRef(false);
  useEffect(() => () => { if (starting.current && !liveSharing.current()) void endLive().catch(() => {}); }, []);
  // The desktop app's System audio takes a screen's capture for its sound (selectionOf).
  const ready = available && !reason && !elsewhere && (kind.intent !== "live" || !!audioDeviceId && audioDeviceId !== "default" && !!live.settings && !live.save.isPending && !live.save.error) && (!lists || !!(kind.pictures ? source : sources?.some(item => item.kind === "screen")));

  const checkAccess = async (on = kind) => {
    const text = await couchApp?.captureAccess?.(on.capture).catch(() => null);
    setBlocked(text ? { kind: on.id, text } : null);
  };
  const list = async () => {
    if (!couchApp?.captureSources) return;
    setListing(true); setError(null);
    try {
      const next = await couchApp.captureSources();
      setSources(next);
      if (!next.length) await checkAccess();
    } catch (reason) { setError(errorText(reason)); await checkAccess(); }
    finally { setListing(false); }
  };
  // The desktop app lists its screens and windows as it opens, and again on returning from the system's settings.
  useEffect(() => { if (lists) void list(); }, [lists]);
  useEffect(() => {
    if (!blocked) return;
    const recheck = () => { void checkAccess().then(() => { if (lists) void list(); }); };
    addEventListener("focus", recheck);
    return () => removeEventListener("focus", recheck);
  }, [blocked, kind]);
  // A screen is chosen for you while there is one; a window waits for your choice.
  useEffect(() => { if (kind.pictures === "screen" && pictures?.length && !source) setSourceId(pictures[0]!.id); }, [kind, sources]);

  const chooseInput = async () => {
    setListing(true); setError(null);
    try {
      starting.current = true;
      const next = await liveAudioInputs(kind.intent === "live").finally(() => { starting.current = false; });
      setInputs(next);
      setAudioDeviceId(previous => next.some(input => input.deviceId === previous) ? previous : kind.intent === "live" ? "" : "default");
      if (!next.length) setError("No audio inputs are available. Connect a microphone or audio interface and try again.");
    } catch (reason) { setError(errorText(reason)); await checkAccess(); }
    finally { setListing(false); }
  };
  // Start the capture, then play it on the chosen devices in order: the first plays it, the rest join it.
  const share = async () => {
    if (!ready) return;
    setPending(true); setError(null);
    try {
      starting.current = true;
      const started = await startLive(selectionOf(kind, { source, sources: sources ?? undefined, audioDeviceId, quality, sound })).finally(() => { starting.current = false; });
      onDone();
      // Without a choice it waits in Home's Shared sources, as it always has.
      if (!chosen.length) { void navigate({ to: "/" }); return; }
      // The first device that takes it plays it; each one after joins that playback.
      let playing = false;
      for (const device of chosen) {
        if (!playing) playing = await run({ type: "playLive", sourceId: started.id, deviceId: device.id });
        else await command({ type: "playLive", sourceId: started.id, deviceId: device.id }).catch(reason => report(errorText(reason)));
      }
    } catch (reason) { setError(errorText(reason)); await checkAccess(); }
    finally { setPending(false); }
  };

  const access = blocked?.kind === kind.id && <Alert>
    <AlertDescription>{kind.pictures ? "Couch can't see your screens and windows. " : ""}{blocked.text}</AlertDescription>
    {couchApp?.openCaptureSettings && <AlertAction><Button type="button" variant="outline" size="sm" onClick={() => void couchApp?.openCaptureSettings?.(kind.capture).catch(reason => setError(errorText(reason)))}>Open System Settings</Button></AlertAction>}
  </Alert>;

  return <form className="grid min-w-0 gap-4" onSubmit={event => { event.preventDefault(); void share(); }}>
    <div className="grid gap-2">
      <ToggleGroup type="single" aria-label="What to share" spacing={2} className="w-full flex-wrap" value={kind.inputs ? "microphone" : kind.id} disabled={pending || listing}
        onValueChange={value => { const next = kinds.find(item => item.id === value); if (next) { setKind(next); setError(null); setSourceId(""); } }}>
        {kinds.map(item => <ToggleGroupItem key={item.id} value={item.id} className={chip} disabled={!!unavailable(item, browser)} title={unavailable(item, browser)}>
          {item.capture === kind.capture && item.pictures === kind.pictures ? <Check aria-hidden="true" /> : <item.icon aria-hidden="true" />}{item.label}
        </ToggleGroupItem>)}
      </ToggleGroup>
      <p className="text-meta text-muted-foreground">{kind.capture === "system-audio" && !couchApp?.captureSources
        ? "Choose a tab or screen and enable audio in your browser's picker. Only sound is shared."
        : kind.description}</p>
      {kinds.some(item => unavailable(item, browser)) && <p className="text-meta text-muted-foreground">{reason ?? kinds.map(item => unavailable(item, browser)).find(Boolean)}</p>}
    </div>
    {access || lists && kind.pictures && <Pictures sources={pictures} listing={listing} value={sourceId} onValueChange={setSourceId} disabled={pending} kind={kind} />}
    {kind.inputs && localHost && <Row label="Playback" description={kind.intent === "live" ? "Listeners join and control their own volume." : "Shared listening with playback controls."}>
      <ChoiceGroup label="Audio input playback" value={kind.intent ?? "relaxed"} disabled={!available || !!reason}
        options={[{ value: "relaxed", label: "Relaxed" }, { value: "live", label: "Live" }]}
        onValueChange={value => { setKind(shareKinds.find(item => item.inputs && (item.intent ?? "relaxed") === value)!); setError(null); }} />
    </Row>}
    {kind.inputs && <Row label="Device" htmlFor="live-audio-input">
      <div className="grid min-w-0 max-w-full justify-items-end gap-1">
        <Select value={audioDeviceId} disabled={!available || !!reason || kind.intent === "live" && !inputs?.length} onValueChange={setAudioDeviceId}>
          <SelectTrigger id="live-audio-input" className="w-56 max-w-full"><SelectValue placeholder="Choose an input" /></SelectTrigger>
          <SelectContent data-tv-local-only position="popper" className="max-w-[calc(100vw-2rem)]">{kind.intent !== "live" && <SelectItem value="default">System default</SelectItem>}{inputs?.filter(input => input.deviceId !== "default").map((input, index) => <SelectItem key={input.deviceId} value={input.deviceId} className="[overflow-wrap:anywhere]">{input.label || `Audio input ${index + 1}`}</SelectItem>)}</SelectContent>
        </Select>
        {/* Browsers name inputs only once microphone access is allowed. */}
        <Button type="button" variant="ghost" size="sm" className="-mr-3" disabled={!available || !!reason} onClick={() => void chooseInput()}>{inputs ? "Refresh inputs" : "Find audio inputs"}</Button>
        <span role="status" className="text-meta text-muted-foreground empty:hidden">{listing ? "Finding inputs…" : ""}</span>
      </div>
    </Row>}
    {kind.intent === "live" && <Row label="Playback buffer (ms)" htmlFor="share-live-buffer" description="More rides out Wi-Fi and phone hiccups.">
      <PlaybackBufferInput id="share-live-buffer" live={live} disabled={pending} className="ml-auto" />
    </Row>}
    {kind.intent === "live" && <LiveSettingsStatus live={live} />}
    {devices.length > 0 && <Row label="Play on">
      <ToggleGroup type="multiple" aria-label="Play on" spacing={2} className="flex-wrap justify-end" value={chosen.map(device => device.id)} disabled={pending} onValueChange={setTargets}>
        {devices.map(device => <ToggleGroupItem key={device.id} value={device.id} className={cn(chip, "h-auto min-h-control max-w-full whitespace-normal")} disabled={!takes(device)} title={takes(device) ? undefined : "Private"}>
          {chosen.includes(device) && <Check aria-hidden="true" />}<span className="min-w-0 [overflow-wrap:anywhere]">{device.name}</span>
        </ToggleGroupItem>)}
      </ToggleGroup>
    </Row>}
    {kind.pictures && <>
      <Row label={couchApp?.captureSources ? "Include system audio" : "Include audio"} htmlFor="live-include-audio" description={couchApp?.captureSources ? "Everything this computer plays, even when sharing one window." : "Enable audio in the browser's picker when offered."}>
        <Switch id="live-include-audio" checked={sound} disabled={pending} onCheckedChange={setSound} />
      </Row>
      <Row label="Picture" htmlFor="live-video-quality">
        <QualitySelect id="live-video-quality" value={quality} disabled={pending} onValueChange={setQuality} />
      </Row>
    </>}
    {elsewhere && <Alert><AlertDescription>This device is already sharing {elsewhere.name} from another window. Stop sharing there first.</AlertDescription></Alert>}
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    {/* On a phone the Sheet's Close cancels, and Start sharing takes the thumb's whole reach. */}
    <div className="flex justify-end gap-2 pt-2">
      <Button type="button" variant="ghost" className={pending ? undefined : "max-sm:hidden"} onClick={onDone}>Cancel</Button>
      <Button type="submit" className="max-sm:flex-1" disabled={!ready}>{pending ? <><Spinner />Starting…</> : "Start sharing"}</Button>
    </div>
    <span role="status" className="sr-only">{pending ? "Starting sharing…" : ""}</span>
  </form>;
}

/** The picture's quality: up to 30 fps, at most this resolution. */
export function QualitySelect({ id, value, disabled, onValueChange }: { id?: string; value: LiveVideoQuality; disabled?: boolean; onValueChange: (value: LiveVideoQuality) => void }) {
  return <Select value={value} disabled={disabled} onValueChange={value => onValueChange(value as LiveVideoQuality)}>
    <SelectTrigger id={id} aria-label={id ? undefined : "Picture"} className="w-56"><SelectValue placeholder="Choose picture quality" /></SelectTrigger>
    <SelectContent data-tv-local-only>{Object.entries(qualityLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
  </Select>;
}

/**
 * The screens or windows to choose from, as small pictures with their names (the desktop app shows them for its own
 * Couch only); another Couch's page lists their names alone.
 */
function Pictures({ sources, listing, value, onValueChange, disabled, kind }: { sources?: CaptureSource[] | false; listing: boolean; value: string; onValueChange: (value: string) => void; disabled: boolean; kind: ShareKind }) {
  const label = kind.pictures === "window" ? "Windows" : "Screens";
  if (!sources) return listing ? <p role="status" className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Spinner />Finding {label.toLowerCase()}…</p> : null;
  if (!sources.length) return <p className="py-6 text-sm text-muted-foreground">No {label.toLowerCase()} to share.</p>;
  if (!sources.some(source => source.thumbnail)) return <ChoiceGroup label={label} orientation="vertical" value={value} disabled={disabled} onValueChange={onValueChange} options={sources.map(source => ({ value: source.id, label: source.name }))} />;
  return <ToggleGroup type="single" aria-label={label} spacing={0} value={value} disabled={disabled} onValueChange={next => { if (next) onValueChange(next); }}
    className="grid max-h-80 w-full grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] items-start gap-x-3 gap-y-4 overflow-y-auto rounded-none p-1">
    {sources.map(source => <ToggleGroupItem key={source.id} value={source.id} title={source.name}
      className="group/picture h-auto min-w-0 flex-col items-stretch justify-start gap-1.5 rounded-md p-0 text-left font-normal whitespace-normal focus-visible:bg-transparent focus-visible:text-foreground data-[state=on]:bg-transparent">
      <span className={cn("grid aspect-video place-items-center overflow-hidden rounded-md bg-muted outline-2 outline-offset-2 outline-transparent group-focus-visible/picture:outline-foreground", source.id === value && "outline-foreground")}>
        {source.thumbnail && <img src={source.thumbnail} alt="" className="size-full object-contain" />}
      </span>
      <span className="line-clamp-2 text-meta">{source.name}</span>
    </ToggleGroupItem>)}
  </ToggleGroup>;
}
