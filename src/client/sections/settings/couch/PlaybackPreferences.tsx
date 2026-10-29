import { playbackControls } from "@/session/playback-controls";
import type { PlaybackControls } from "../../../../shared/protocol";
import { useMutation } from "@tanstack/react-query";
import { ChoiceGroup } from "@/components/ChoiceGroup";
import { SettingsRow } from "@/components/SettingsRow";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { WatchingProfile } from "../../../../shared/viewing";
import type { Action, PlaybackPreferences as Preferences, ProfilePlaybackPreferences } from "../../../../shared/protocol";
import { playbackLanguages } from "../../../playback-languages";
import { playbackSpeeds } from "../../../../shared/playback-default";

const languages = [{ value: "", label: "Original" }, { value: "it", label: "Italiano" }, { value: "en", label: "English" }];

export function PlaybackPreferences({ profile, preferences, connected, onCommand, controls: rights }: {
  controls?: PlaybackControls;
  profile: WatchingProfile;
  preferences: Preferences;
  connected: boolean;
  onCommand: (action: Action) => Promise<boolean>;
}) {
  const controls = playbackControls({ controls: rights });
  const save = useMutation({
    mutationFn: async (patch: Partial<ProfilePlaybackPreferences>) => {
      if (!await onCommand({ type: "preferences", profileId: profile.id, preferences: patch })) throw new Error("Couldn't save. Try again.");
    },
  });
  // Show the pending choice until the session snapshot carries it.
  const values = { ...preferences.profile, ...(save.isPending ? save.variables : {}) };
  const disabled = !connected || save.isPending;
  const apply = (patch: Partial<ProfilePlaybackPreferences>) => { if (!disabled) save.mutate(patch); };

  // Subtitles is one row: Off, or the language to show them in.
  const language = (label: string, value: string, choices: { value: string; label: string }[], pick: (code: string) => Partial<ProfilePlaybackPreferences>) => (
    <SettingsRow label={label}>
      <ChoiceGroup label={label} value={value} options={choices} disabled={disabled} onValueChange={code => apply(pick(code))} />
      <Select value={choices.some(choice => choice.value === value) ? "more" : value} disabled={disabled} onValueChange={code => apply(pick(code))}>
        <SelectTrigger aria-label={`More ${label.toLowerCase()} options`} className="w-auto"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="more" disabled>More languages</SelectItem>
          {playbackLanguages(value).filter(item => !choices.some(choice => choice.value === item.code)).map(item => <SelectItem key={item.code} value={item.code}>{item.name}</SelectItem>)}
        </SelectContent>
      </Select>
    </SettingsRow>
  );
  const speeds = [...new Set([...playbackSpeeds, values.speed])].sort((a, b) => a - b).map(value => ({ value: String(value), label: `${value}×` }));
  return <>
    {controls.queue && <SettingsRow label="Autoplay" htmlFor="playback-autoplay" description="Continue the current series, album or playlist after your queued items.">
      <Switch id="playback-autoplay" checked={values.autoplay !== false} disabled={disabled} onCheckedChange={autoplay => apply({ autoplay })} />
    </SettingsRow>}
    {controls.programme && language("Audio language", values.audioLanguage, languages, audioLanguage => ({ audioLanguage }))}
    {controls.programme && language("Subtitles", values.subtitles === "off" ? "off" : values.subtitleLanguage, [{ value: "off", label: "Off" }, ...languages],
      code => code === "off" ? { subtitles: "off" } : { subtitles: "auto", subtitleLanguage: code })}
    {controls.speed && <SettingsRow label="Speed">
      <ChoiceGroup label="Speed" value={String(values.speed)} options={speeds} disabled={disabled} onValueChange={value => apply({ speed: Number(value) })} />
    </SettingsRow>}
    {save.error && <Alert variant="destructive"><AlertDescription>{save.error.message}</AlertDescription></Alert>}
  </>;
}
