import { useShell } from "@/sections/shell/AppShell";
import { ChoiceGroup } from "@/components/ChoiceGroup";
import { SettingsRow, SettingsSection } from "@/components/SettingsRow";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { VideoQuality } from "../../../../shared/providers";
import { SettingsLayout } from "../SettingsLayout";
import { PlaybackPreferences } from "./PlaybackPreferences";
import { useSessionGate } from "@/session/session-context";

const qualities: { value: VideoQuality; label: string }[] = [
  { value: "auto", label: "Auto (1080p)" }, { value: "best", label: "Best" }, { value: "1080p", label: "1080p" }, { value: "720p", label: "720p" }, { value: "480p", label: "480p" },
];

// Route composition only; playback changes remain socket commands.
export function PlaybackPage() {
  const { credentials } = useShell();
  const { connected, state, run, videoQualityPreference } = useSessionGate();
  const profile = state?.activeProfile;
  const preferences = state?.preferences;
  return (
    <SettingsLayout section="playback">
      <SettingsSection>
        <SettingsRow label="Video quality" description="Online video from this device.">
          <ChoiceGroup label="Video quality" value={videoQualityPreference.quality} options={qualities} onValueChange={videoQualityPreference.save} />
        </SettingsRow>
        {profile && preferences && credentials && <PlaybackPreferences key={profile.id} profile={profile} preferences={preferences} connected={connected} onCommand={run} />}
      </SettingsSection>
      {videoQualityPreference.error && <Alert variant="destructive"><AlertDescription>{videoQualityPreference.error}</AlertDescription></Alert>}
    </SettingsLayout>
  );
}
