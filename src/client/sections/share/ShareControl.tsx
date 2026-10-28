import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ScreenShare, SlidersVertical, Square, Users, X } from "lucide-react";
import { Level } from "@/components/Level";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { LiveSharing } from "@/session/live";
import type { LiveRoute } from "@/session/live-route";
import { errorText, useSessionGate } from "@/session/session-context";
import { isDesktop, subscribeDesktop } from "@/sections/shell/Outputs";
import { dismiss, stillSharing } from "@/toasts";
import { LiveListeners, LiveSettings } from "./LiveOperator";
import { QualitySelect, ShareDialog } from "./ShareDialog";
import { shareKindOf, viewerLine, viewersOf, type Viewer } from "./share";
import { useShowShare } from "./show-share";

/**
 * The header's Share (docs/design/share.md): a button that opens the Share dialog on a device that can capture, and,
 * while this device shares, a separate row showing what goes out, who watches, and Stop sharing. Both stay this
 * device's own: another device's Remote never reaches them on a TV. Settings can hide the button (a TV does by
 * default), never the capsule.
 */
export function ShareControl() {
  const { state, localLiveSourceId, liveSharing, tvPresentation } = useSessionGate();
  const source = state?.liveSources?.find(item => item.id === localLiveSourceId);
  const sharing = source ? liveSharing.current() : null;
  const viewers = source ? viewersOf(state, source.id) : [];
  const stop = useStop();
  const { shown } = useShowShare();
  // The capture keeps running once nobody watches: one toast, each time the last viewer leaves, gone once a viewer
  // returns or the share ends; its Stop stops only the share it spoke of.
  const watched = useRef(false);
  useEffect(() => {
    if (viewers.length) { watched.current = true; dismiss("sharing"); }
    else if (watched.current && sharing) {
      watched.current = false;
      const id = sharing.source.id;
      stillSharing(sharing.source.name, () => { if (liveSharing.current()?.source.id === id) void stop.run(); }, sharing.source.intent === "live");
    }
    if (!sharing) { watched.current = false; dismiss("sharing"); }
  }, [viewers.length, sharing?.source.id]);
  return <>
    <div className="app-header-share-entry size-11">
      {!sharing && shown && !!navigator.mediaDevices?.getUserMedia && <ShareButton className="size-11 px-0" tv={tvPresentation}>
        <ScreenShare aria-hidden="true" />
      </ShareButton>}
    </div>
    {sharing && <div className="app-header-sharing min-w-0"><Capsule sharing={sharing} viewers={viewers} stop={stop} tv={tvPresentation} /></div>}
  </>;
}

/** A button that opens the Share dialog: the header's, or Settings' while the header hides it. */
export function ShareButton({ className, tv, children }: { className?: string; tv: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  return <>
    <Button ref={opener} data-tv-local-only variant="secondary" className={className} aria-label="Share screen or sound" title="Share screen or sound" onClick={() => setOpen(true)}>{children}</Button>
    <ShareDialog open={open} onOpenChange={setOpen} tv={tv} openerRef={opener} />
  </>;
}

function useStop() {
  const { endLive, setError } = useSessionGate();
  const [pending, setPending] = useState(false);
  const run = async () => {
    if (pending) return;
    setPending(true);
    try { await endLive(); } catch (reason) { setError(errorText(reason)); }
    finally { setPending(false); }
  };
  return { pending, run };
}

/** A silent picture of what goes out, from the capture the page already holds; a sound's kind where there is none. */
function Preview({ sharing, className }: { sharing: LiveSharing; className?: string }) {
  const kind = shareKindOf(sharing.source.kind === "airplay" ? "screen" : sharing.source.kind, sharing.surface, sharing.source.intent);
  if (!sharing.stream.getVideoTracks().length) return <span className={cn("grid aspect-square place-items-center rounded-full bg-foreground text-background", className)}><kind.icon aria-hidden="true" className="size-1/2" /></span>;
  return <video muted autoPlay playsInline aria-hidden="true" ref={video => { if (video && video.srcObject !== sharing.stream) video.srcObject = sharing.stream; }}
    className={cn("aspect-video rounded-sm bg-muted object-contain", className)} />;
}

function Capsule({ sharing, viewers, stop, tv }: { sharing: LiveSharing; viewers: Viewer[]; stop: ReturnType<typeof useStop>; tv: boolean }) {
  const [open, setOpen] = useState(false);
  const desktop = useSyncExternalStore(subscribeDesktop, isDesktop, () => false);
  const label = `Sharing ${sharing.source.name}`;
  const trigger = <button type="button" aria-label={`${label}, show sharing controls`} title={label}
    className="flex min-w-0 items-center gap-2.5 rounded-full py-1 pr-3 pl-1 text-sm text-foreground/80 outline-none hover:text-foreground aria-expanded:text-foreground">
    <Preview sharing={sharing} className="h-7 shrink-0" />
    <span role="status" aria-label={label} className="min-w-0 max-w-80 truncate">{sharing.source.name}</span>
    {viewers.length > 0 && <span className="flex shrink-0 items-center gap-1 text-meta text-muted-foreground tabular-nums" aria-label={`${viewers.length} ${sharing.source.intent === "live" ? "listening" : "watching"}`}><Users aria-hidden="true" className="size-3.5" />{viewers.length}</span>}
  </button>;
  const panel = <SharingPanel sharing={sharing} viewers={viewers} onClose={() => setOpen(false)} />;
  // Toasts' floating surface, without the bar's filter: the bar's glass is a page's one backdrop filter (design.md, Glass).
  return <div data-live-sharing data-tv-local-only className="flex w-fit min-w-0 max-w-full items-center gap-1 rounded-full bg-bar p-0.5 shadow-(--float-shadow)">
    {desktop && !tv ? <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent data-tv-local-only align="center" collisionPadding={16} aria-label="Sharing" className="max-h-(--radix-popover-content-available-height) w-[min(26rem,calc(100vw-2rem))] gap-0 overflow-y-auto p-4">{panel}</PopoverContent>
    </Popover> : <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent data-tv-local-only side="bottom" aria-describedby={undefined} showCloseButton={false} className="max-h-[85dvh] items-center overflow-y-auto px-(--gutter) pt-4 pb-8">
        <SheetTitle className="sr-only">Sharing</SheetTitle>
        <div className="grid w-full max-w-xl">
          <div className="flex justify-end"><SheetClose asChild><Button variant="ghost" size="icon-lg" className="-mr-2.5" aria-label="Close" title="Close"><X aria-hidden="true" /></Button></SheetClose></div>
          {panel}
        </div>
      </SheetContent>
    </Sheet>}
    <Button variant="secondary" size="sm" aria-label={stop.pending ? "Stopping…" : "Stop sharing"} title="Stop sharing" disabled={stop.pending} onClick={() => void stop.run()}>
      <Square aria-hidden="true" />{stop.pending ? "Stopping…" : "Stop"}
    </Button>
  </div>;
}

/**
 * Who watches, how each gets it, the picture's quality or the microphone's mute, then Where it plays; Stop sharing stays
 * on the capsule.
 * Core's scheduled delivery names sync status; WebRTC names its selected candidate route.
 */
function SharingPanel({ sharing: shown, viewers, onClose }: { sharing: LiveSharing; viewers: Viewer[]; onClose: () => void }) {
  const { state, connected, liveSharing, openWhereItPlays, setError } = useSessionGate();
  // Read again on each render: quality and mute change the capture, not the session's state.
  const sharing = liveSharing.current() ?? shown;
  const [routes, setRoutes] = useState<Record<string, LiveRoute>>({});
  const [, refresh] = useState(0);
  useEffect(() => {
    if (sharing.source.audioDelivery === "pcm") return;
    let live = true;
    const read = () => void liveSharing.routes().then(next => { if (live) setRoutes(next); });
    read();
    const timer = setInterval(read, 2_000);
    return () => { live = false; clearInterval(timer); };
  }, [liveSharing, sharing.source.audioDelivery]);
  const kind = shareKindOf(sharing.source.kind === "airplay" ? "screen" : sharing.source.kind, sharing.surface, sharing.source.intent);
  const what = kind.pictures && sharing.source.audio ? `${kind.label}, with this computer's sound` : kind.label;
  const since = new Date(sharing.since).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const viewing = state?.playbacks?.find(playback => playback.id === state.playback)?.liveSourceId === sharing.source.id;
  const behind = viewers.some(viewer => viewer.behind && viewer.delivery !== "scheduled");
  return <div className="grid gap-4">
    <div className="flex items-center gap-3">
      <Preview sharing={sharing} className={sharing.stream.getVideoTracks().length ? "w-36 shrink-0" : "size-12 shrink-0"} />
      <div className="grid min-w-0 gap-0.5">
        <p className="text-title font-medium break-words">{sharing.source.name}</p>
        {/* The name already ends in a screen's kind ("Studio Mac · Screen"): say it again only to add to it. */}
        {!sharing.source.name.endsWith(` · ${what}`) && <p className="text-meta text-muted-foreground">{what}</p>}
        <p className="text-meta text-muted-foreground">Since {since}</p>
        {/* The Capture buffer control shows the request; the device's own size appears only when it differs. */}
        {sharing.source.intent === "live" && sharing.captureFormat && <p className="text-meta text-muted-foreground">Capture: {sharing.captureFormat.sampleRate / 1000} kHz, {sharing.captureFormat.channels === 1 ? "Mono" : `${sharing.captureFormat.channels} channels`}{sharing.captureFormat.native && sharing.captureFormat.native.reportedFrames !== sharing.captureFormat.native.requestedFrames
          ? `, device buffer ${sharing.captureFormat.native.reportedFrames} frames` : ""}</p>}
      </div>
    </div>
    {/* Live audio's host sees each listener as Core measures it, and sets the stream below. */}
    {sharing.source.intent === "live" ? <LiveListeners viewers={viewers} /> : <ul aria-label="Watching" className="grid">
      {viewers.map(viewer => <li key={viewer.device.id} className="flex items-center gap-3 border-t py-2.5">
        <div className="grid min-w-0 flex-1 gap-0.5">
          <span className="text-body break-words">{viewer.device.name}</span>
          <span className={cn("text-meta", viewer.error ? "text-destructive" : "text-muted-foreground")}>{viewerLine(viewer, routes[viewer.device.id])}</span>
        </div>
        {viewer.sound && <Level moving={viewer.playing && !viewer.behind && !viewer.error && viewer.device.online && !viewer.device.muted && viewer.device.volume > 0} className="text-muted-foreground" />}
      </li>)}
      {!viewers.length && <li className="border-t py-2.5 text-meta text-muted-foreground">Not playing anywhere yet.</li>}
    </ul>}
    {sharing.source.kind === "screen" && <div className="flex items-center justify-between gap-4 border-t pt-3">
      <label className="text-body">Picture</label>
      <QualitySelect value={sharing.quality} onValueChange={quality => void liveSharing.setQuality(quality).then(() => refresh(count => count + 1), reason => setError(errorText(reason)))} />
    </div>}
    {sharing.source.kind === "microphone" && <div className="flex items-center justify-between gap-4 border-t pt-3">
      <label htmlFor="live-mute" className="text-body">Mute audio input</label>
      <Switch id="live-mute" checked={sharing.muted} disabled={!connected} onCheckedChange={muted => { liveSharing.setMuted(muted); refresh(count => count + 1); }} />
    </div>}
    {sharing.source.intent === "live" && <LiveSettings sharing={sharing} onCaptureChange={() => refresh(count => count + 1)} />}
    {behind && <p className="text-meta text-muted-foreground">{sharing.relay
      ? "A device marked behind couldn't connect directly, even through the relay."
      : <>A device marked behind couldn't connect directly. A relay can fix that, in <Link to="/settings/couch/devices" className="text-foreground underline underline-offset-4" onClick={onClose}>Devices &amp; network</Link>.</>}</p>}
    {viewing && sharing.source.intent !== "live" && <Button variant="ghost" className="-ml-2.5 justify-self-start" onClick={() => { onClose(); openWhereItPlays(); }}><SlidersVertical aria-hidden="true" />Where it plays</Button>}
  </div>;
}
