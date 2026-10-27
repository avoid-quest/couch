import { useCaptureRatePreference } from "@/audio-settings";
import { SettingsRow, SettingsSection } from "@/components/SettingsRow";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { captureRateOptions } from "../../../shared/audio-settings";

export function ClientAudioSettings({ capture = false }: { capture?: boolean }) {
  const rate = useCaptureRatePreference();
  if (!capture) return null;
  return <SettingsSection title="Advanced audio">
    <SettingsRow label="Live audio capture sample rate" htmlFor="live-capture-rate" description="For the next Live share. An explicit rate also changes a native input's device rate, which other apps share.">
      <Select value={rate.value} onValueChange={rate.save}>
        <SelectTrigger id="live-capture-rate"><SelectValue /></SelectTrigger>
        <SelectContent>{captureRateOptions.map(value => <SelectItem key={value} value={value}>{value === "auto" ? "Automatic" : `${Number(value) / 1000} kHz`}</SelectItem>)}</SelectContent>
      </Select>
    </SettingsRow>
    {rate.error && <Alert variant="destructive"><AlertDescription>{rate.error}</AlertDescription></Alert>}
  </SettingsSection>;
}
