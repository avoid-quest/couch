import { useShell } from "@/sections/shell/AppShell";
import { ChoiceGroup } from "@/components/ChoiceGroup";
import { SettingsRow, SettingsSection } from "@/components/SettingsRow";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { SettingsLayout } from "../SettingsLayout";
import { PlaybackPreferences } from "./PlaybackPreferences";
import { videoQualityOptions } from "@/video-quality";
import { useSessionGate } from "@/session/session-context";


// Route composition only; playback changes remain socket commands.
export function PlaybackPage() {
  const { credentials } = useShell();
  const { nativeHost, connected, state, run, videoQualityPreference, screenWakeLock } = useSessionGate();
  const profile = state?.activeProfile;
  const preferences = state?.preferences;
  return (
    <SettingsLayout section="playback">
      <SettingsSection>
        {!nativeHost && <SettingsRow label="Keep screen awake" htmlFor="keep-screen-awake"
          description={`While playing on this device, with Couch visible.${screenWakeLock.reason ? ` ${screenWakeLock.reason}` : ""}`}>
          <Switch id="keep-screen-awake" checked={screenWakeLock.enabled} disabled={!screenWakeLock.supported} onCheckedChange={screenWakeLock.save} />
          {screenWakeLock.retryable && <Button variant="outline" onClick={screenWakeLock.retry}>Try again</Button>}
        </SettingsRow>}
        <SettingsRow label="Video quality" description="Online video from this device.">
          <ChoiceGroup label="Video quality" value={videoQualityPreference.quality} options={videoQualityOptions} onValueChange={videoQualityPreference.save} />
        </SettingsRow>
        {profile && preferences && credentials && <PlaybackPreferences key={profile.id} profile={profile} preferences={preferences} connected={connected} onCommand={run} />}
      </SettingsSection>
      {videoQualityPreference.error && <Alert variant="destructive"><AlertDescription>{videoQualityPreference.error}</AlertDescription></Alert>}
      {!nativeHost && screenWakeLock.error && <Alert><AlertDescription>{screenWakeLock.error}</AlertDescription></Alert>}
    </SettingsLayout>
  );
}
