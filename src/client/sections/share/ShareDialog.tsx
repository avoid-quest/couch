import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { ChoiceGroup } from "@/components/ChoiceGroup";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { deviceId } from "@/session/device-id";
import { couchApp } from "@/session/native-context";
import { errorText, useSessionGate } from "@/session/session-context";
import { isDesktop, subscribeDesktop } from "@/sections/shell/Outputs";
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
export function ShareDialog({ open, onOpenChange, tv, openerRef }: { open: boolean; onOpenChange: (open: boolean) => void; tv: boolean; openerRef: RefObject<HTMLButtonElement | null> }) {
  const desktop = useSyncExternalStore(subscribeDesktop, isDesktop, () => false);
  const restoreFocus = (event: Event) => { if (openerRef.current?.isConnected) { event.preventDefault(); openerRef.current.focus(); } };
  const title = "Share this device";
  // Its choices reset each time it opens, and capture is asked for only from the device in hand.
  const body = open && <ShareForm onDone={() => onOpenChange(false)} />;
  if (desktop && !tv) return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent data-tv-local-only aria-describedby={undefined} onCloseAutoFocus={restoreFocus} className="gap-0 sm:max-w-2xl"><DialogTitle className="mb-5 font-display text-heading">{title}</DialogTitle>{body}</DialogContent>
  </Dialog>;
  return <Sheet open={open} onOpenChange={onOpenChange}>
    <SheetContent data-tv-local-only side="bottom" aria-describedby={undefined} onCloseAutoFocus={restoreFocus} className="max-h-[90dvh] items-center overflow-y-auto px-(--gutter) pt-6 pb-8">
      <div className="grid w-full max-w-2xl"><SheetTitle className="mb-5 font-display text-heading">{title}</SheetTitle>{body}</div>
    </SheetContent>
  </Sheet>;
}

function ShareForm({ onDone }: { onDone: () => void }) {
  const { state, connected, startLive, endLive, liveAudioInputs, liveSharing, run, command, setError: report } = useSessionGate();
  const navigate = useNavigate();
  const here = deviceId();
  const browser = { media: !!navigator.mediaDevices?.getUserMedia, display: !!navigator.mediaDevices?.getDisplayMedia };
  const [kind, setKind] = useState<ShareKind>(() => shareKinds.find(item => !unavailable(item, browser)) ?? shareKinds[0]!);
  const [sources, setSources] = useState<CaptureSource[] | null>(null);
  const [sourceId, setSourceId] = useState("");
  const [inputs, setInputs] = useState<MediaDeviceInfo[] | null>(null);
  const [audioDeviceId, setAudioDeviceId] = useState("default");
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
  // The desktop app's Sound only takes a screen's capture for its sound (selectionOf).
  const ready = available && !reason && !elsewhere && (!lists || !!(kind.pictures ? source : sources?.some(item => item.kind === "screen")));

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
      const next = await liveAudioInputs().finally(() => { starting.current = false; });
      setInputs(next);
      setAudioDeviceId(previous => next.some(input => input.deviceId === previous) ? previous : "default");
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
    {couchApp?.openCaptureSettings && <AlertAction><Button variant="outline" size="sm" onClick={() => void couchApp?.openCaptureSettings?.(kind.capture).catch(reason => setError(errorText(reason)))}>Open System Settings</Button></AlertAction>}
  </Alert>;

  return <div className="grid gap-4">
    <div className="grid gap-2">
      <ToggleGroup type="single" aria-label="What to share" spacing={2} className="w-full flex-wrap" value={kind.id} disabled={pending}
        onValueChange={value => { const next = shareKinds.find(item => item.id === value); if (next) { setKind(next); setError(null); setSourceId(""); } }}>
        {shareKinds.map(item => <ToggleGroupItem key={item.id} value={item.id} className={chip} disabled={!!unavailable(item, browser)} title={unavailable(item, browser)}>
          {item.id === kind.id ? <Check aria-hidden="true" /> : <item.icon aria-hidden="true" />}{item.label}
        </ToggleGroupItem>)}
      </ToggleGroup>
      {shareKinds.some(item => unavailable(item, browser)) && <p className="text-meta text-muted-foreground">{reason ?? shareKinds.map(item => unavailable(item, browser)).find(Boolean)}</p>}
    </div>
    {access || lists && kind.pictures && <Pictures sources={pictures} listing={listing} value={sourceId} onValueChange={setSourceId} disabled={pending} kind={kind} />}
    {kind.inputs && <Row label="Input" htmlFor="live-audio-input">
      <div className="grid justify-items-end gap-1">
        <Select value={audioDeviceId} disabled={!available || !!reason} onValueChange={setAudioDeviceId}>
          <SelectTrigger id="live-audio-input" className="w-56"><SelectValue /></SelectTrigger>
          <SelectContent data-tv-local-only><SelectItem value="default">System default</SelectItem>{inputs?.filter(input => input.deviceId !== "default").map((input, index) => <SelectItem key={input.deviceId} value={input.deviceId}>{input.label || `Audio input ${index + 1}`}</SelectItem>)}</SelectContent>
        </Select>
        {/* Browsers name inputs only once microphone access is allowed. */}
        <Button variant="ghost" size="sm" className="-mr-3" disabled={!available || !!reason} onClick={() => void chooseInput()}>{listing ? <><Spinner />Finding inputs…</> : inputs ? "Refresh inputs" : "Choose audio input"}</Button>
      </div>
    </Row>}
    {devices.length > 0 && <Row label="Play on">
      <ToggleGroup type="multiple" aria-label="Play on" spacing={2} className="flex-wrap justify-end" value={chosen.map(device => device.id)} disabled={pending} onValueChange={setTargets}>
        {devices.map(device => <ToggleGroupItem key={device.id} value={device.id} className={chip} disabled={!takes(device)} title={takes(device) ? undefined : "Private"}>
          {chosen.includes(device) && <Check aria-hidden="true" />}{device.name}
        </ToggleGroupItem>)}
      </ToggleGroup>
    </Row>}
    {kind.pictures && <>
      <Row label="Include this computer's sound" htmlFor="live-include-audio" description="Everything it plays, even when sharing one window.">
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
      {pending ? <Button variant="ghost" onClick={() => void endLive().catch(reason => setError(errorText(reason)))}>Cancel</Button> : <Button variant="ghost" className="max-sm:hidden" onClick={onDone}>Cancel</Button>}
      <Button className="max-sm:flex-1" disabled={!ready} onClick={() => void share()}>{pending ? <><Spinner />Starting…</> : "Start sharing"}</Button>
    </div>
  </div>;
}

/** The picture's quality: up to 30 fps, at most this resolution. */
export function QualitySelect({ id, value, disabled, onValueChange }: { id?: string; value: LiveVideoQuality; disabled?: boolean; onValueChange: (value: LiveVideoQuality) => void }) {
  return <Select value={value} disabled={disabled} onValueChange={value => onValueChange(value as LiveVideoQuality)}>
    <SelectTrigger id={id} aria-label={id ? undefined : "Picture"} className="w-56"><SelectValue /></SelectTrigger>
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
      className="group/picture h-auto touch:h-auto min-w-0 flex-col items-stretch justify-start gap-1.5 rounded-md p-0 text-left font-normal whitespace-normal focus-visible:bg-transparent focus-visible:text-foreground data-[state=on]:bg-transparent">
      <span className={cn("grid aspect-video place-items-center overflow-hidden rounded-md bg-muted outline-2 outline-offset-2 outline-transparent group-focus-visible/picture:outline-foreground", source.id === value && "outline-foreground")}>
        {source.thumbnail && <img src={source.thumbnail} alt="" className="size-full object-contain" />}
      </span>
      <span className="line-clamp-2 text-meta">{source.name}</span>
    </ToggleGroupItem>)}
  </ToggleGroup>;
}
