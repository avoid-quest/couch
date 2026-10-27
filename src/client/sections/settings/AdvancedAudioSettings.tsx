import { useQuery } from "@tanstack/react-query";
import { useCaptureRatePreference, useOutputBufferPreference } from "@/audio-settings";
import { couchApp } from "@/session/native-context";
import { SettingsRow, SettingsSection } from "@/components/SettingsRow";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { captureRateOptions, outputBufferOptions } from "../../../shared/audio-settings";

// The Live stream's own settings (lead, codec, buffers) live in the share panel while it runs (docs/design/share.md).
export function ClientAudioSettings({ capture = false }: { capture?: boolean }) {
  const rate = useCaptureRatePreference();
  const preference = useOutputBufferPreference();
  const nativeInputs = useQuery({ queryKey: ["native-audio-inputs"], queryFn: () => couchApp?.nativeAudioInputs?.() ?? Promise.resolve([]), enabled: capture && !!couchApp?.nativeAudioInputs, retry: false, refetchOnWindowFocus: false });
  return <SettingsSection title="Advanced audio">
    <SettingsRow label="Live browser output buffering" htmlFor="live-output-buffer" description="A browser preference, not a guaranteed hardware buffer. Frame counts assume 48 kHz. Automatic takes the host's listener buffer. Applies when you leave and rejoin.">
      <Select value={preference.value} onValueChange={preference.save}>
        <SelectTrigger id="live-output-buffer"><SelectValue /></SelectTrigger>
        <SelectContent>{outputBufferOptions.map(value => <SelectItem key={value} value={value}>{value === "auto" ? "Automatic" : `${value} frames · ${(Number(value) / 48).toFixed(1)} ms`}</SelectItem>)}</SelectContent>
      </Select>
    </SettingsRow>
    {capture && <SettingsRow label="Live audio capture sample rate" htmlFor="live-capture-rate" description={nativeInputs.data?.length ? "For the next Live share. Native inputs change the device rate, which can affect other apps; Automatic keeps its current rate. Browser inputs may resample." : "For the next Live audio input share. Verifies the delivered rate; the browser may resample the sound card. Automatic prefers 48 kHz."}>
      <Select value={rate.value} onValueChange={rate.save}>
        <SelectTrigger id="live-capture-rate"><SelectValue /></SelectTrigger>
        <SelectContent>{captureRateOptions.map(value => <SelectItem key={value} value={value}>{value === "auto" ? "Automatic" : `${Number(value) / 1000} kHz`}</SelectItem>)}</SelectContent>
      </Select>
    </SettingsRow>}
    {capture && rate.error && <Alert variant="destructive"><AlertDescription>{rate.error}</AlertDescription></Alert>}
    {preference.error && <Alert variant="destructive"><AlertDescription>{preference.error}</AlertDescription></Alert>}
  </SettingsSection>;
}
