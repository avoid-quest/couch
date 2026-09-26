import { useMutation } from "@tanstack/react-query";
import { ChoiceGroup } from "@/components/ChoiceGroup";
import { SettingsRow } from "@/components/SettingsRow";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { WatchingProfile } from "../../../../shared/library";
import type { Action, PlaybackPreferences as Preferences, ProfilePlaybackPreferences } from "../../../../shared/protocol";
import { playbackLanguages } from "../../../playback-languages";

const languages = [{ value: "", label: "Original" }, { value: "it", label: "Italiano" }, { value: "en", label: "English" }];

export function PlaybackPreferences({ profile, preferences, connected, onCommand }: {
  profile: WatchingProfile;
  preferences: Preferences;
  connected: boolean;
  onCommand: (action: Action) => Promise<boolean>;
}) {
  const save = useMutation({
    mutationFn: async (patch: Partial<ProfilePlaybackPreferences>) => {
      if (!await onCommand({ type: "preferences", profileId: profile.id, preferences: patch })) throw new Error("Couldn't save. Try again.");
    },
  });
  // Show the pending choice until the session snapshot carries it.
  const values = { ...preferences.profile, ...(save.isPending ? save.variables : {}) };
  const disabled = !connected || save.isPending;
  const apply = (patch: Partial<ProfilePlaybackPreferences>) => { if (!disabled) save.mutate(patch); };

  const language = (label: string, key: "audioLanguage" | "subtitleLanguage") => (
    <SettingsRow label={label}>
      <ChoiceGroup label={label} value={values[key]} options={languages} disabled={disabled} onValueChange={code => apply({ [key]: code })} />
      <Select value={languages.some(choice => choice.value === values[key]) ? "more" : values[key]} disabled={disabled} onValueChange={code => apply({ [key]: code })}>
        <SelectTrigger aria-label={`More ${label.toLowerCase()} options`} className="w-auto"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="more" disabled>More languages</SelectItem>
          {playbackLanguages(values[key]).filter(item => !languages.some(choice => choice.value === item.code)).map(item => <SelectItem key={item.code} value={item.code}>{item.name}</SelectItem>)}
        </SelectContent>
      </Select>
    </SettingsRow>
  );
  const speeds = [...new Set([1, 1.25, 1.5, values.speed])].sort((a, b) => a - b).map(value => ({ value: String(value), label: `${value}×` }));
  return <>
    <SettingsRow label="Autoplay" htmlFor="playback-autoplay" className="[&_label]:touch:min-h-11 [&_label]:items-center" description="Continue the current series, album or playlist after your queued items.">
      <Switch id="playback-autoplay" checked={values.autoplay !== false} disabled={disabled} onCheckedChange={autoplay => apply({ autoplay })} />
    </SettingsRow>
    {language("Audio language", "audioLanguage")}
    <SettingsRow label="Subtitles">
      <ChoiceGroup label="Subtitles" value={values.subtitles} options={[{ value: "auto", label: "Automatic" }, { value: "off", label: "Off" }]} disabled={disabled} onValueChange={value => apply({ subtitles: value })} />
    </SettingsRow>
    {language("Subtitle language", "subtitleLanguage")}
    <SettingsRow label="Speed">
      <ChoiceGroup label="Speed" value={String(values.speed)} options={speeds} disabled={disabled} onValueChange={value => apply({ speed: Number(value) })} />
    </SettingsRow>
    <SettingsRow label="Volume leveling" description="Music only.">
      <ChoiceGroup label="Volume leveling" value={values.replayGain} options={[{ value: "off", label: "Off" }, { value: "track", label: "Track" }, { value: "album", label: "Album" }]} disabled={disabled} onValueChange={value => apply({ replayGain: value })} />
    </SettingsRow>
    {save.error && <Alert variant="destructive"><AlertDescription>{save.error.message}</AlertDescription></Alert>}
  </>;
}
