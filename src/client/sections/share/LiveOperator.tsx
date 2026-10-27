import { useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiSend } from "@/api/client";
import { liveAudioSettingsQuery } from "@/api/settings";
import { useNativeInputBufferPreference } from "@/audio-settings";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { LiveSharing } from "@/session/live";
import { errorText, useSessionGate } from "@/session/session-context";
import { nativeInputBufferOptions, type LiveAudioSettings } from "../../../shared/audio-settings";
import { viewerLine, type Viewer } from "./share";

export function LiveListeners({ viewers }: { viewers: Viewer[] }) {
  const { run } = useSessionGate();
  return <ul aria-label="Listening" className="grid">
    {viewers.map(viewer => <li key={viewer.device.id} className="flex items-center gap-3 border-t py-2">
      <div className="grid min-w-0 flex-1 gap-0.5">
        <span className="text-body break-words">{viewer.device.name}</span>
        <span className="text-meta text-muted-foreground">{viewerLine(viewer, undefined)}</span>
      </div>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={`Options for ${viewer.device.name}`}><MoreHorizontal aria-hidden="true" /></Button></DropdownMenuTrigger>
        <DropdownMenuContent data-tv-local-only align="end"><DropdownMenuItem onSelect={() => void run({ type: "removeLiveListener", playbackId: viewer.playbackId, deviceId: viewer.device.id })}>Remove</DropdownMenuItem></DropdownMenuContent>
      </DropdownMenu>
    </li>)}
    {!viewers.length && <li className="border-t py-2.5 text-meta text-muted-foreground">Not playing anywhere yet.</li>}
  </ul>;
}

/** The saved Live audio settings: Couch-wide, applied to every Live share and its listeners. */
export function useLiveAudioSettings(enabled = true) {
  const { credentials, setError } = useSessionGate();
  const client = useQueryClient();
  const query = useQuery({ ...liveAudioSettingsQuery(credentials!), enabled: enabled && !!credentials });
  const save = useMutation({ mutationFn: (settings: LiveAudioSettings) => apiSend<LiveAudioSettings>(credentials!, "/api/settings/live-audio", { settings }),
    onSuccess: value => client.setQueryData(liveAudioSettingsQuery(credentials!).queryKey, value), onError: reason => setError(errorText(reason)) });
  return { settings: query.data, save };
}

/** Each listener's Sendspin minimum buffer, saved on blur. */
export function PlaybackBufferInput({ id, live, className }: { id: string; live: ReturnType<typeof useLiveAudioSettings>; className?: string }) {
  const { settings, save } = live;
  if (!settings) return null;
  return <Input key={settings.minBufferMs} id={id} className={cn("w-44", className)} type="number" min={0} max={5000} step={1} defaultValue={settings.minBufferMs} disabled={save.isPending}
    onBlur={event => { const minBufferMs = event.currentTarget.valueAsNumber; if (event.currentTarget.validity.valid && Number.isInteger(minBufferMs) && minBufferMs !== settings.minBufferMs) save.mutate({ ...settings, minBufferMs }); }} />;
}

/** Public Sendspin options for the running share; playback timing/recovery stays upstream. */
export function LiveSettings({ sharing }: { sharing: LiveSharing }) {
  const { liveSharing, setError } = useSessionGate();
  const live = useLiveAudioSettings();
  const { settings, save } = live;
  const nativeBuffer = useNativeInputBufferPreference();
  const [restarting, setRestarting] = useState(false);
  const native = sharing.captureFormat?.native;
  if (!settings) return null;
  return <div className="grid gap-2 border-t pt-2">
    {native && <div className="flex items-center justify-between gap-4">
      <label htmlFor="live-capture-buffer">Capture buffer</label>
      <Select value={String(native.requestedFrames)} disabled={restarting} onValueChange={value => {
        nativeBuffer.save(value); setRestarting(true);
        void liveSharing.setCaptureBuffer(Number(value) as 128 | 256 | 512 | 1024).catch(reason => setError(errorText(reason))).finally(() => setRestarting(false));
      }}><SelectTrigger id="live-capture-buffer" className="w-44"><SelectValue /></SelectTrigger>
        <SelectContent data-tv-local-only>{nativeInputBufferOptions.map(value => <SelectItem key={value} value={value}>{value} frames</SelectItem>)}</SelectContent>
      </Select>
    </div>}
    <div className="flex items-center justify-between gap-4">
      <label htmlFor="live-codec">Codec</label>
      <Select value={settings.codec} disabled={save.isPending} onValueChange={codec => save.mutate({ ...settings, codec: codec as LiveAudioSettings["codec"] })}>
        <SelectTrigger id="live-codec" className="w-44"><SelectValue /></SelectTrigger>
        <SelectContent data-tv-local-only><SelectItem value="auto">Automatic</SelectItem><SelectItem value="pcm">PCM</SelectItem><SelectItem value="opus">Opus</SelectItem></SelectContent>
      </Select>
    </div>
    <div className="flex items-center justify-between gap-4">
      <label htmlFor="live-buffer">Playback buffer (ms)</label>
      <PlaybackBufferInput id="live-buffer" live={live} />
    </div>
    {/* Core keeps the largest lead a running share has used, so listeners never jump backwards mid-stream. */}
    <p className="text-meta text-muted-foreground">A larger buffer applies now. A smaller one applies when sharing restarts.</p>
  </div>;
}
