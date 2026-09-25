import { useShell } from "@/sections/shell/AppShell";
import { SettingsLayout } from "../SettingsLayout";
import { QualitySelect } from "@/components/QualitySelect";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Check } from "lucide-react";
import type { VideoQuality } from "../../../../shared/providers";
import { PlaybackPreferences } from "./PlaybackPreferences";

// Route composition only; playback changes remain socket commands.
export function PlaybackPage() {
  const shell = useShell();
  const { credentials, connected, state, run, videoQualityPreference, standardLayout: redesigned } = shell;
  const profile = state?.activeProfile;
  const preferences = state?.preferences;
  return (
    <SettingsLayout section="playback">
      <div className={redesigned ? "settings-playback-rows" : "space-y-6"}>
        {redesigned ? <div className="settings-choice-row grid grid-cols-[16rem_minmax(0,1fr)] items-baseline gap-4 border-t border-border py-3 max-[900px]:grid-cols-1">
          <span className="text-base">Video quality</span>
          <div role="group" aria-label="Video quality" className="flex flex-wrap items-center gap-x-1 gap-y-1">
            {([ ["auto", "Recommended"], ["best", "Best"], ["1080p", "1080p"], ["720p", "720p"], ["480p", "480p"] ] as const).map(([value, label]) => <Button key={value} variant="ghost" className="h-9 gap-1.5 rounded-sm px-2.5 text-base font-normal" disabled={!connected} aria-pressed={videoQualityPreference.quality === value} onClick={() => videoQualityPreference.save(value as VideoQuality)}>
              <Check aria-hidden="true" className={`size-4 ${videoQualityPreference.quality === value ? "" : "invisible"}`} />{label}
            </Button>)}
          </div>
        </div> : <QualitySelect id="playback-default-quality" value={videoQualityPreference.quality} disabled={!connected} onChange={videoQualityPreference.save}
          description="Stored on this client. The selected playback host uses it for the next video you play or add." />}
        {redesigned && videoQualityPreference.error && <p role="alert" className="text-sm text-destructive">{videoQualityPreference.error}</p>}
        {!redesigned && <Separator />}
        {profile && preferences && credentials
          ? <PlaybackPreferences key={profile.id} profile={profile} preferences={preferences} connected={connected} onCommand={run} />
          : <p className="text-muted-foreground">Connect to the selected playback host to load playback defaults.</p>}
      </div>
    </SettingsLayout>
  );
}
