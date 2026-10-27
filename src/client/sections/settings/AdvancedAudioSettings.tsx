import { useQuery } from "@tanstack/react-query";
import { useCaptureRatePreference } from "@/audio-settings";
import { couchApp } from "@/session/native-context";
import { SettingsRow, SettingsSection } from "@/components/SettingsRow";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { captureRateOptions } from "../../../shared/audio-settings";

export function ClientAudioSettings({ capture = false }: { capture?: boolean }) {
  const rate = useCaptureRatePreference();
  const nativeInputs = useQuery({ queryKey: ["native-audio-inputs"], queryFn: () => couchApp?.nativeAudioInputs?.() ?? Promise.resolve([]), enabled: capture && !!couchApp?.nativeAudioInputs, retry: false, refetchOnWindowFocus: false });
  if (!capture) return null;
  return <SettingsSection title="Advanced audio">
    <SettingsRow label="Live audio capture sample rate" htmlFor="live-capture-rate" description={nativeInputs.data?.length ? "For the next Live share. Native inputs change the device rate, which can affect other apps; Automatic keeps its current rate. Browser inputs may resample." : "For the next Live audio input share. Verifies the delivered rate; the browser may resample the sound card. Automatic prefers 48 kHz."}>
      <Select value={rate.value} onValueChange={rate.save}>
        <SelectTrigger id="live-capture-rate"><SelectValue /></SelectTrigger>
        <SelectContent>{captureRateOptions.map(value => <SelectItem key={value} value={value}>{value === "auto" ? "Automatic" : `${Number(value) / 1000} kHz`}</SelectItem>)}</SelectContent>
      </Select>
    </SettingsRow>
    {rate.error && <Alert variant="destructive"><AlertDescription>{rate.error}</AlertDescription></Alert>}
  </SettingsSection>;
}
