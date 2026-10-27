import { useState, type ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiSend } from "@/api/client";
import { liveAudioSettingsQuery, liveListenersQuery } from "@/api/settings";
import { useNativeInputBufferPreference } from "@/audio-settings";
import { Level } from "@/components/Level";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { LiveSharing } from "@/session/live";
import { errorText, useSessionGate } from "@/session/session-context";
import { bufferFrameOptions, opusBitrates } from "../../../shared/audio-settings";
import type { LiveAudioSettings } from "../../../shared/protocol";
import { listenerLine, type Viewer } from "./share";

type Frames = typeof bufferFrameOptions[number];
const maxLeadMs = 250;

// The share's settings, shared by its listeners' rows (the lead, Fixed's starting value) and its controls.
function useLiveAudio(sourceId: string) {
  const { state, credentials, setError } = useSessionGate();
  const client = useQueryClient();
  const status = useQuery({ ...liveListenersQuery(credentials!, sourceId), enabled: !!credentials });
  const query = useQuery({ ...liveAudioSettingsQuery(credentials!), enabled: !!credentials });
  const save = useMutation({
    mutationFn: (settings: Partial<LiveAudioSettings>) => apiSend<LiveAudioSettings>(credentials!, "/api/settings/live-audio", { settings }),
    onSuccess: value => client.setQueryData(liveAudioSettingsQuery(credentials!).queryKey, value),
    onError: reason => setError(errorText(reason)),
  });
  const settings = query.data && { ...query.data, ...save.isPending ? save.variables : {} };
  const leadMs = status.data?.leadMs ?? state?.playbacks?.find(playback => playback.liveSourceId === sourceId && playback.liveLeadMs !== undefined)?.liveLeadMs;
  return { status: status.data, settings, leadMs, change: (patch: Partial<LiveAudioSettings>) => save.mutate(patch) };
}

/**
 * The host's view of a Live audio share's listeners (docs/design/share.md): each as Core measures it, read every second
 * while the panel is open, and the lead they share.
 */
export function LiveListeners({ sharing, viewers }: { sharing: LiveSharing; viewers: Viewer[] }) {
  const { run } = useSessionGate();
  const { status, settings, leadMs } = useLiveAudio(sharing.source.id);
  const inputLatencyMs = sharing.captureFormat?.native?.inputLatencyMs;
  const listenerOf = (viewer: Viewer) => status?.listeners.find(item => item.deviceId === viewer.device.id) ?? viewer.liveListener;
  // The maximum matters once it leaves someone behind.
  const atMaximum = settings?.lead === "automatic" && leadMs !== undefined && leadMs >= settings.maxLeadMs && viewers.some(viewer => listenerOf(viewer)?.status === "behind");
  const summary = [viewers.length > 0 && `${viewers.length} listening`, leadMs !== undefined && `Lead ${leadMs} ms${atMaximum ? ", at its maximum" : ""}`,
    leadMs !== undefined && inputLatencyMs !== undefined && `Full loop ≈ ${Math.round(leadMs + inputLatencyMs)} ms`].filter(Boolean).join(" · ");
  return <div className="grid gap-1">
    {summary && <p className="text-meta text-muted-foreground tabular-nums" title="Full loop is an estimate: the lead plus the input latency the audio interface reports.">{summary}</p>}
    <ul aria-label="Listening" className="grid">
      {viewers.map(viewer => {
        const listener = listenerOf(viewer);
        return <li key={viewer.device.id} className="flex items-center gap-3 border-t py-2">
          <div className="grid min-w-0 flex-1 gap-0.5">
            <span className="text-body break-words">{viewer.device.name}</span>
            <span className={cn("text-meta tabular-nums", viewer.error ? "text-destructive" : "text-muted-foreground")}>{listenerLine(viewer, listener)}</span>
          </div>
          <Level moving={viewer.playing && !viewer.error && !!listener && ["ok", "limiting", "behind"].includes(listener.status) && viewer.device.online && !viewer.device.muted && viewer.device.volume > 0} className="text-muted-foreground" />
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="-mr-2" aria-label={`Options for ${viewer.device.name}`}><MoreHorizontal aria-hidden="true" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent data-tv-local-only align="end">
              <DropdownMenuItem onSelect={() => void run({ type: "removeLiveListener", playbackId: viewer.playbackId, deviceId: viewer.device.id })}>Remove</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </li>;
      })}
      {!viewers.length && <li className="border-t py-2.5 text-meta text-muted-foreground">Not playing anywhere yet.</li>}
    </ul>
  </div>;
}

/**
 * The stream's settings. Each change applies at once to the running share and becomes the next share's default: the
 * lead ramps, while a new codec or capture buffer starts the listeners over, as their rows show.
 */
export function LiveSettings({ sharing }: { sharing: LiveSharing }) {
  const { liveSharing } = useSessionGate();
  const { settings, leadMs, change } = useLiveAudio(sharing.source.id);
  const nativeBuffer = useNativeInputBufferPreference();
  const [restarting, setRestarting] = useState(false);
  const native = sharing.captureFormat?.native;
  if (!settings) return null;
  const captureBuffer = (frames: Frames) => {
    nativeBuffer.save(String(frames)); setRestarting(true);
    void liveSharing.setCaptureBuffer(frames).finally(() => setRestarting(false));
  };
  return <div className="grid border-t pt-2">
    {/* Only a native input has a buffer to choose. */}
    {native && <Row label="Capture buffer" htmlFor="live-capture-buffer">
      <FramesSelect id="live-capture-buffer" value={native.requestedFrames as Frames} disabled={restarting} onValueChange={captureBuffer} />
    </Row>}
    <Row label="Codec" htmlFor="live-codec">
      <Select value={settings.codec} onValueChange={codec => change({ codec: codec as LiveAudioSettings["codec"] })}>
        <SelectTrigger id="live-codec" className="w-44"><SelectValue /></SelectTrigger>
        <SelectContent data-tv-local-only><SelectItem value="pcm">PCM</SelectItem><SelectItem value="opus">Opus</SelectItem></SelectContent>
      </Select>
    </Row>
    {settings.codec === "opus" && <Row label="Bitrate" htmlFor="live-bitrate">
      <Select value={String(settings.opusBitrate)} onValueChange={value => change({ opusBitrate: Number(value) as LiveAudioSettings["opusBitrate"] })}>
        <SelectTrigger id="live-bitrate" className="w-44"><SelectValue /></SelectTrigger>
        <SelectContent data-tv-local-only>{opusBitrates.map(bitrate => <SelectItem key={bitrate} value={String(bitrate)}>{bitrate / 1000} kbps</SelectItem>)}</SelectContent>
      </Select>
    </Row>}
    <Row label="Lead" htmlFor="live-lead">
      {/* Fixed starts where the lead is now. */}
      <Select value={settings.lead} onValueChange={lead => change(lead === "fixed" ? { lead, leadMs: Math.min(maxLeadMs, leadMs ?? settings.leadMs) } : { lead: "automatic" })}>
        <SelectTrigger id="live-lead" className="w-44"><SelectValue /></SelectTrigger>
        <SelectContent data-tv-local-only><SelectItem value="automatic">Automatic</SelectItem><SelectItem value="fixed">Fixed</SelectItem></SelectContent>
      </Select>
    </Row>
    {settings.lead === "fixed" ? <LeadSlider label="Fixed at" value={settings.leadMs} onCommit={value => change({ leadMs: value })} /> : <>
      <LeadSlider label="Maximum" value={settings.maxLeadMs} onCommit={value => change({ maxLeadMs: value, minLeadMs: Math.min(settings.minLeadMs, value) })} />
      <LeadSlider label="Minimum" value={settings.minLeadMs} onCommit={value => change({ minLeadMs: value, maxLeadMs: Math.max(settings.maxLeadMs, value) })} />
      <Row label="Raise for the slowest" htmlFor="live-raise">
        <Switch id="live-raise" checked={settings.raiseForSlowest} onCheckedChange={raiseForSlowest => change({ raiseForSlowest })} />
      </Row>
    </>}
    <Row label="Listener buffer" htmlFor="live-listener-buffer">
      <FramesSelect id="live-listener-buffer" value={settings.listenerBufferFrames} onValueChange={listenerBufferFrames => change({ listenerBufferFrames })} />
    </Row>
  </div>;
}

function Row({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
  return <div className="flex min-h-10 items-center justify-between gap-4 touch:min-h-12"><label htmlFor={htmlFor} className="text-body">{label}</label>{children}</div>;
}

function FramesSelect({ id, value, disabled, onValueChange }: { id: string; value: Frames; disabled?: boolean; onValueChange: (frames: Frames) => void }) {
  return <Select value={String(value)} disabled={disabled} onValueChange={frames => onValueChange(Number(frames) as Frames)}>
    <SelectTrigger id={id} className="w-44"><SelectValue /></SelectTrigger>
    <SelectContent data-tv-local-only>{bufferFrameOptions.map(frames => <SelectItem key={frames} value={String(frames)}>{frames} frames · {(frames / 48).toFixed(1)} ms</SelectItem>)}</SelectContent>
  </Select>;
}

// Milliseconds of lead, sent when the thumb is let go.
function LeadSlider({ label, value, onCommit }: { label: string; value: number; onCommit: (value: number) => void }) {
  const [draft, setDraft] = useState<number | null>(null);
  const shown = draft ?? value;
  return <div className="grid min-h-10 grid-cols-[minmax(0,9rem)_minmax(0,1fr)_3.5rem] items-center gap-3 touch:min-h-12">
    <span className="text-body">{label}</span>
    <Slider aria-label={label} aria-valuetext={`${shown} ms`} min={0} max={maxLeadMs} step={1} value={[Math.min(maxLeadMs, shown)]}
      onValueChange={values => setDraft(values[0]!)} onValueCommit={values => { setDraft(null); onCommit(values[0]!); }} />
    <span className="text-right text-meta text-muted-foreground tabular-nums">{shown} ms</span>
  </div>;
}
