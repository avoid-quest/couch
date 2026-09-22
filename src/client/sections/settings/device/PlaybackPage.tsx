import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { useShell } from "@/sections/shell/AppShell";
import { SettingsLayout } from "../SettingsLayout";
import { QualitySelect } from "@/components/QualitySelect";
import { PlaybackPreferences } from "./PlaybackPreferences";

// Route composition only; playback changes remain socket commands.
export function PlaybackPage() {
  const shell = useShell();
  const { credentials, connected, state, run, videoQualityPreference } = shell;
  const profile = state?.activeProfile;
  const preferences = state?.preferences;
  return (
    <SettingsLayout section="playback">
      <div className="space-y-6">
        <QualitySelect id="playback-default-quality" value={videoQualityPreference.quality} disabled={!connected} onChange={videoQualityPreference.save}
          description="Stored on this client. The selected playback host uses it for the next video you play or add." />
        <Separator />
        {profile && preferences && credentials
          ? <PlaybackPreferences key={profile.id} profile={profile} preferences={preferences} connected={connected} onCommand={run} />
          : <p className="text-muted-foreground">Connect to the selected playback host to load playback defaults.</p>}
      </div>
    </SettingsLayout>
  );
}
