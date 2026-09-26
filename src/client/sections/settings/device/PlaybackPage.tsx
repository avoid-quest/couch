import { useShell } from "@/sections/shell/AppShell";
import { ChoiceGroup } from "@/components/ChoiceGroup";
import { SettingsRow, SettingsSection } from "@/components/SettingsRow";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { SettingsLayout } from "../SettingsLayout";
import { PlaybackPreferences } from "./PlaybackPreferences";
import { videoQualityOptions } from "@/video-quality";
import { useSessionGate } from "@/session/session-context";


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
          <ChoiceGroup label="Video quality" value={videoQualityPreference.quality} options={videoQualityOptions} onValueChange={videoQualityPreference.save} />
        </SettingsRow>
        {profile && preferences && credentials && <PlaybackPreferences key={profile.id} profile={profile} preferences={preferences} connected={connected} onCommand={run} />}
      </SettingsSection>
      {videoQualityPreference.error && <Alert variant="destructive"><AlertDescription>{videoQualityPreference.error}</AlertDescription></Alert>}
    </SettingsLayout>
  );
}
