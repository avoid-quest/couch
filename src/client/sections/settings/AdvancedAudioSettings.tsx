import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiSend, type ApiCredentials } from "@/api/client";
import { audioSettingsQuery } from "@/api/settings";
import { useCaptureRatePreference, useLiveOutputBackend, useNativeInputBufferPreference, useNativeOutputBuffer, useOutputBufferPreference } from "@/audio-settings";
import { couchApp } from "@/session/native-context";
import { SettingsRow, SettingsSection } from "@/components/SettingsRow";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ADMIN_ONLY } from "@/copy";
import { captureRateOptions, defaultLiveAudioLeadMs, liveAudioLeadOptions, nativeInputBufferOptions, outputBufferOptions } from "../../../shared/audio-settings";
import { nativeOutputBufferOptions } from "../../../shared/native-output";

export function HostAudioSettings({ credentials, connected, administrator }: { credentials: ApiCredentials; connected: boolean; administrator: boolean }) {
  const client = useQueryClient();
  const query = useQuery({ ...audioSettingsQuery(credentials), enabled: connected && administrator });
  const save = useMutation({
    mutationFn: (liveAudioLeadMs: number) => apiSend<{ liveAudioLeadMs: number }>(credentials, "/api/settings/audio", { liveAudioLeadMs }),
    onSuccess: value => client.setQueryData(audioSettingsQuery(credentials).queryKey, value),
  });
  return <SettingsSection title="Advanced audio">
    <SettingsRow label="Live audio scheduling lead" htmlFor="live-audio-lead" description={administrator ? "More time can help slower devices and networks, at the cost of latency. Applies to new Live audio shares." : ADMIN_ONLY}>
      {administrator && <Select value={query.data ? String(save.isPending ? save.variables : query.data.liveAudioLeadMs) : ""} disabled={!connected || query.isPending || query.isError || save.isPending} onValueChange={value => save.mutate(Number(value))}>
        <SelectTrigger id="live-audio-lead"><SelectValue placeholder="Loading…" /></SelectTrigger>
        <SelectContent>{liveAudioLeadOptions.map(ms => <SelectItem key={ms} value={String(ms)}>{ms} ms{ms === defaultLiveAudioLeadMs ? " (default)" : ""}</SelectItem>)}</SelectContent>
      </Select>}
    </SettingsRow>
    {(query.error || save.error) && <Alert variant="destructive"><AlertDescription>{save.error?.message ?? query.error?.message}</AlertDescription></Alert>}
  </SettingsSection>;
}

export function ClientAudioSettings({ capture = false }: { capture?: boolean }) {
  const rate = useCaptureRatePreference();
  const preference = useOutputBufferPreference();
  const nativeBuffer = useNativeInputBufferPreference();
  const backend = useLiveOutputBackend(), outputBuffer = useNativeOutputBuffer();
  const nativeOutput = useQuery({ queryKey: ["native-audio-output"], queryFn: () => couchApp?.nativeAudioOutputAvailable?.() ?? Promise.resolve(false), enabled: !!couchApp?.nativeAudioOutputAvailable, retry: false });
  const nativeInputs = useQuery({ queryKey: ["native-audio-inputs"], queryFn: () => couchApp?.nativeAudioInputs?.() ?? Promise.resolve([]), enabled: capture && !!couchApp?.nativeAudioInputs, retry: false, refetchOnWindowFocus: false });
  return <SettingsSection title="Advanced audio">
    {nativeOutput.data && <SettingsRow label="Live audio output" htmlFor="live-output-backend" description="Applies when you leave and rejoin audio-only Live streams. Video continues to use the browser output.">
      <Select value={backend.value} onValueChange={backend.save}>
        <SelectTrigger id="live-output-backend"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="browser">Browser (default)</SelectItem><SelectItem value="native">Native · system output</SelectItem></SelectContent>
      </Select>
    </SettingsRow>}
    {nativeOutput.data && backend.value === "native" && <SettingsRow label="Native output buffering" htmlFor="live-native-output-buffer" description="Requests a stream buffer from the system audio server; does not change the sound card buffer. Stereo, 48 kHz. Larger values may need more host scheduling lead.">
      <Select value={outputBuffer.value} onValueChange={outputBuffer.save}>
        <SelectTrigger id="live-native-output-buffer"><SelectValue /></SelectTrigger>
        <SelectContent>{nativeOutputBufferOptions.map(value => <SelectItem key={value} value={value}>{value} ms{value === "20" ? " (default)" : ""}</SelectItem>)}</SelectContent>
      </Select>
    </SettingsRow>}
    <SettingsRow label="Live browser output buffering" htmlFor="live-output-buffer" description="A browser preference, not a guaranteed hardware buffer. Frame counts assume 48 kHz. Applies when you leave and rejoin; larger values may need more host scheduling lead.">
      <Select value={preference.value} onValueChange={preference.save}>
        <SelectTrigger id="live-output-buffer"><SelectValue /></SelectTrigger>
        <SelectContent>{outputBufferOptions.map(value => <SelectItem key={value} value={value}>{value === "auto" ? "Automatic (browser default)" : `${value} frames · ${(Number(value) / 48).toFixed(1)} ms`}</SelectItem>)}</SelectContent>
      </Select>
    </SettingsRow>
    {capture && <SettingsRow label="Live audio capture sample rate" htmlFor="live-capture-rate" description={nativeInputs.data?.length ? "For the next Live share. Native inputs change the device rate, which can affect other apps; Automatic keeps its current rate. Browser inputs may resample." : "For the next Live audio input share. Verifies the delivered rate; the browser may resample the sound card. Automatic prefers 48 kHz."}>
      <Select value={rate.value} onValueChange={rate.save}>
        <SelectTrigger id="live-capture-rate"><SelectValue /></SelectTrigger>
        <SelectContent>{captureRateOptions.map(value => <SelectItem key={value} value={value}>{value === "auto" ? "Automatic" : `${Number(value) / 1000} kHz`}</SelectItem>)}</SelectContent>
      </Select>
    </SettingsRow>}
    {capture && !!nativeInputs.data?.length && <SettingsRow label="Native input buffer" htmlFor="live-native-input-buffer" description="For inputs marked Native in Live audio. Applies on the next share; the reported size appears in sharing controls.">
      <Select value={nativeBuffer.value} onValueChange={nativeBuffer.save}>
        <SelectTrigger id="live-native-input-buffer"><SelectValue /></SelectTrigger>
        <SelectContent>{nativeInputBufferOptions.map(value => <SelectItem key={value} value={value}>{value} frames{value === "256" ? " (default)" : ""}</SelectItem>)}</SelectContent>
      </Select>
    </SettingsRow>}
    {capture && nativeBuffer.error && <Alert variant="destructive"><AlertDescription>{nativeBuffer.error}</AlertDescription></Alert>}
    {capture && rate.error && <Alert variant="destructive"><AlertDescription>{rate.error}</AlertDescription></Alert>}
    {preference.error && <Alert variant="destructive"><AlertDescription>{preference.error}</AlertDescription></Alert>}
    {(backend.error || outputBuffer.error) && <Alert variant="destructive"><AlertDescription>{backend.error ?? outputBuffer.error}</AlertDescription></Alert>}
  </SettingsSection>;
}
