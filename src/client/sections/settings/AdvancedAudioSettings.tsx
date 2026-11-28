import { useCaptureRatePreference } from "@/audio-settings";
import { ChoiceGroup } from "@/components/ChoiceGroup";
import { SettingsRow } from "@/components/SettingsRow";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { captureRateOptions } from "../../../shared/audio-settings";

export function ClientAudioSettings({ capture = false }: { capture?: boolean }) {
  const rate = useCaptureRatePreference();
  if (!capture) return null;
  return (
    <>
      <SettingsRow
        label="Live audio capture sample rate"
        description="For the next Live share. An explicit rate also changes a native input's device rate, which other apps share."
      >
        <ChoiceGroup
          label="Live audio capture sample rate"
          variant="segmented"
          value={rate.value}
          options={captureRateOptions.map((value) => ({
            value,
            label: value === "auto" ? "Automatic" : `${Number(value) / 1000} kHz`,
          }))}
          onValueChange={rate.save}
        />
      </SettingsRow>
      {rate.error && (
        <Alert variant="destructive">
          <AlertDescription>{rate.error}</AlertDescription>
        </Alert>
      )}
    </>
  );
}
