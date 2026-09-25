import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { WatchingProfile } from "../../../../shared/library";
import type { Action, PlaybackPreferences as Preferences, ProfilePlaybackPreferences } from "../../../../shared/protocol";
import { playbackLanguages } from "../../../playback-languages";

function ChoiceRow<T extends string | number>({ label, value, choices, disabled, onChange, children }: {
  label: string;
  value: T;
  choices: readonly { value: T; label: string }[];
  disabled: boolean;
  onChange: (value: T) => void;
  children?: React.ReactNode;
}) {
  return <div className="settings-choice-row grid grid-cols-[16rem_minmax(0,1fr)] items-baseline gap-4 border-t border-border py-3 max-[900px]:grid-cols-1">
    <span className="text-base">{label}</span>
    <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
      <ToggleGroup type="single" aria-label={label} value={String(value)} disabled={disabled} onValueChange={next => { if (next) onChange(choices.find(choice => String(choice.value) === next)!.value); }} className="flex-wrap justify-start">
        {choices.map(choice => <ToggleGroupItem key={choice.value} value={String(choice.value)} className="h-9 gap-1.5 rounded-sm px-2.5 text-base font-normal">
          <Check aria-hidden="true" className={`size-4 ${value === choice.value ? "" : "invisible"}`} />{choice.label}
        </ToggleGroupItem>)}
      </ToggleGroup>
      {children}
    </div>
  </div>;
}

export function PlaybackPreferences({ profile, preferences, connected, onCommand }: {
  profile: WatchingProfile;
  preferences: Preferences;
  connected: boolean;
  onCommand: (action: Action) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState<Partial<ProfilePlaybackPreferences> | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const values = { ...preferences.profile, ...draft };
  useEffect(() => {
    if (draft && (Object.keys(draft) as (keyof ProfilePlaybackPreferences)[]).every(key => preferences.profile[key] === draft[key])) setDraft(null);
  }, [draft, preferences.profile]);
  const apply = async (patch: Partial<ProfilePlaybackPreferences>) => {
    if (!connected || pending) return;
    setPending(true);
    setDraft(patch);
    setError(null);
    setSaved(false);
    try {
      if (await onCommand({ type: "preferences", profileId: profile.id, preferences: patch })) setSaved(true);
      else { setDraft(null); setError("Could not save playback preferences. Check the connection and try again."); }
    } catch (reason) {
      setDraft(null);
      setError(reason instanceof Error ? reason.message : "Could not save playback preferences.");
    } finally { setPending(false); }
  };

  const languages = [{ value: "", label: "Original" }, { value: "it", label: "Italiano" }, { value: "en", label: "English" }];
  const moreLanguage = (label: string, value: string, key: "audioLanguage" | "subtitleLanguage") => <Select value={languages.some(choice => choice.value === value) ? "more" : value} disabled={!connected || pending} onValueChange={code => void apply({ [key]: code })}>
    <SelectTrigger aria-label={`More ${label.toLowerCase()} options`} className="h-9 min-h-0 w-auto min-w-0 border-0 bg-transparent px-2 text-base shadow-none"><SelectValue /></SelectTrigger>
    <SelectContent><SelectItem value="more" disabled>More languages</SelectItem>{playbackLanguages(value).filter(language => !languages.some(choice => choice.value === language.code)).map(language => <SelectItem key={language.code} value={language.code}>{language.name}</SelectItem>)}</SelectContent>
  </Select>;
  return <section aria-label="Playback defaults">
    <ChoiceRow label="Audio language" value={values.audioLanguage} choices={languages} disabled={!connected || pending} onChange={value => void apply({ audioLanguage: value })}>{moreLanguage("audio language", values.audioLanguage, "audioLanguage")}</ChoiceRow>
    <ChoiceRow label="Subtitles" value={values.subtitles} choices={[{ value: "auto", label: "Automatic" }, { value: "off", label: "Off" }]} disabled={!connected || pending} onChange={value => void apply({ subtitles: value })} />
    <ChoiceRow label="Subtitle language" value={values.subtitleLanguage} choices={languages} disabled={!connected || pending} onChange={value => void apply({ subtitleLanguage: value })}>{moreLanguage("subtitle language", values.subtitleLanguage, "subtitleLanguage")}</ChoiceRow>
    <ChoiceRow label="Speed" value={values.speed} choices={[...new Set([1, 1.25, 1.5, values.speed])].sort((a, b) => a - b).map(value => ({ value, label: `${value}×` }))} disabled={!connected || pending} onChange={value => void apply({ speed: value })} />
    <ChoiceRow label="Music volume levelling" value={values.replayGain} choices={[{ value: "off", label: "Off" }, { value: "track", label: "Track" }, { value: "album", label: "Album" }]} disabled={!connected || pending} onChange={value => void apply({ replayGain: value })} />
    {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
    {saved && <p role="status" className="sr-only">Playback default saved.</p>}
  </section>;
}
