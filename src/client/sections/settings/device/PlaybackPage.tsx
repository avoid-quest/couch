import { useShell } from "@/sections/shell/AppShell";
import { SettingsLayout } from "../SettingsLayout";
import { Check } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { VideoQuality } from "../../../../shared/providers";
import { PlaybackPreferences } from "./PlaybackPreferences";
import { useSessionGate } from "@/session/session-context";

// Route composition only; playback changes remain socket commands.
export function PlaybackPage() {
  const shell = useShell();
  const { credentials } = shell;
  const { connected, state, run, videoQualityPreference } = useSessionGate();
  const profile = state?.activeProfile;
  const preferences = state?.preferences;
  return (
    <SettingsLayout section="playback">
      <div className="settings-playback-rows">
        <div className="settings-choice-row grid grid-cols-[16rem_minmax(0,1fr)] items-baseline gap-4 border-t border-border py-3 max-[900px]:grid-cols-1">
          <span className="text-base">Video quality</span>
          <ToggleGroup type="single" aria-label="Video quality" value={videoQualityPreference.quality} disabled={!connected} onValueChange={value => { if (value) videoQualityPreference.save(value as VideoQuality); }} className="flex-wrap justify-start">
            {([ ["auto", "Recommended"], ["best", "Best"], ["1080p", "1080p"], ["720p", "720p"], ["480p", "480p"] ] as const).map(([value, label]) => <ToggleGroupItem key={value} value={value} className="h-9 gap-1.5 rounded-sm px-2.5 text-base font-normal">
              <Check aria-hidden="true" className={`size-4 ${videoQualityPreference.quality === value ? "" : "invisible"}`} />{label}
            </ToggleGroupItem>)}
          </ToggleGroup>
        </div>
        {videoQualityPreference.error && <p role="alert" className="text-sm text-destructive">{videoQualityPreference.error}</p>}
        {profile && preferences && credentials
          ? <PlaybackPreferences key={profile.id} profile={profile} preferences={preferences} connected={connected} onCommand={run} />
          : <p className="text-muted-foreground">Connect to the selected playback host to load playback defaults.</p>}
      </div>
    </SettingsLayout>
  );
}
