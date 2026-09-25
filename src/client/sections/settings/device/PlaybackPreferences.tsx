import { useEffect, useState, type FormEvent } from "react";
import { Check } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { WatchingProfile } from "../../../../shared/library";
import type { Action, PlaybackPreferences as Preferences, ProfilePlaybackPreferences, ReplayGainMode } from "../../../../shared/protocol";
import { playbackLanguages } from "../../../playback-languages";
import { useOptionalShell } from "@/sections/shell/shell-context";

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
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-x-1 gap-y-1">
      {choices.map(choice => <Button key={choice.value} variant="ghost" className="h-9 gap-1.5 rounded-sm px-2.5 text-base font-normal" disabled={disabled} aria-pressed={value === choice.value} onClick={() => onChange(choice.value)}>
        <Check aria-hidden="true" className={`size-4 ${value === choice.value ? "" : "invisible"}`} />{choice.label}
      </Button>)}
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
  const redesigned = useOptionalShell()?.standardLayout;
  const row = "grid gap-2";
  const values = { ...preferences.profile, ...draft };
  useEffect(() => {
    if (redesigned && draft && (Object.keys(draft) as (keyof ProfilePlaybackPreferences)[]).every(key => preferences.profile[key] === draft[key])) setDraft(null);
  }, [draft, preferences.profile, redesigned]);
  const change = (patch: Partial<ProfilePlaybackPreferences>) => {
    setDraft({ ...draft, ...patch });
    setSaved(false);
    setError(null);
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft) return;
    setPending(true);
    setError(null);
    setSaved(false);
    try {
      const ok = await onCommand({ type: "preferences", profileId: profile.id, preferences: draft });
      if (ok) {
        setDraft(null);
        setSaved(true);
      } else setError("Could not save preferences. Check the connection and try again.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save playback preferences.");
    } finally { setPending(false); }
  };

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

  if (redesigned) {
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

  return <form className="grid gap-4" onSubmit={event => void save(event)}>
    <p className="text-sm text-muted-foreground">Applies to new playback.</p>
    <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
      <div className={row}>
        <Label htmlFor="preferred-audio-language">Preferred audio language</Label>
        <Select value={values.audioLanguage || "automatic"} disabled={!connected || pending} onValueChange={value => change({ audioLanguage: value === "automatic" ? "" : value })}>
          <SelectTrigger id="preferred-audio-language" className="min-h-11 w-full max-w-sm"><SelectValue /></SelectTrigger>
          <SelectContent>{playbackLanguages(values.audioLanguage).map(({ code, name }) => <SelectItem key={code} value={code || "automatic"} className="min-h-11">{name}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className={row}>
        <Label htmlFor="preferred-subtitle-language">Preferred subtitle language</Label>
        <Select value={values.subtitleLanguage || "automatic"} disabled={!connected || pending} onValueChange={value => change({ subtitleLanguage: value === "automatic" ? "" : value })}>
          <SelectTrigger id="preferred-subtitle-language" className="min-h-11 w-full max-w-sm"><SelectValue /></SelectTrigger>
          <SelectContent>{playbackLanguages(values.subtitleLanguage).map(({ code, name }) => <SelectItem key={code} value={code || "automatic"} className="min-h-11">{name}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      <div className={row}>
        <Label htmlFor="preferred-subtitle-mode">Default subtitles</Label>
        <Select value={values.subtitles} disabled={!connected || pending} onValueChange={value => change({ subtitles: value as "auto" | "off" })}>
          <SelectTrigger id="preferred-subtitle-mode" className="min-h-11 w-full max-w-sm"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="auto" className="min-h-11">Automatic</SelectItem><SelectItem value="off" className="min-h-11">Off</SelectItem></SelectContent>
        </Select>
      </div>
      <div className={row}>
        <Label htmlFor="preferred-playback-speed">Default playback speed</Label>
        <Select value={String(values.speed)} disabled={!connected || pending} onValueChange={value => change({ speed: Number(value) })}>
          <SelectTrigger id="preferred-playback-speed" className="min-h-11 w-full max-w-sm"><SelectValue /></SelectTrigger>
          <SelectContent>{[...new Set([0.5, 0.75, 1, 1.25, 1.5, 2, values.speed])].sort((a, b) => a - b).map(speed => <SelectItem key={speed} value={String(speed)} className="min-h-11">{speed === 1 ? "Normal" : `${speed}×`}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className={`${row} sm:col-span-2`}>
        <Label htmlFor="preferred-replaygain">Default music ReplayGain</Label>
        <Select value={values.replayGain} disabled={!connected || pending} onValueChange={value => change({ replayGain: value as ReplayGainMode })}>
          <SelectTrigger id="preferred-replaygain" className="min-h-11 w-full max-w-sm"><SelectValue /></SelectTrigger>
          <SelectContent>{["off", "track", "album"].map(mode => <SelectItem key={mode} value={mode} className="min-h-11">{mode[0]!.toUpperCase() + mode.slice(1)}</SelectItem>)}</SelectContent>
        </Select>
        <p className="text-sm text-muted-foreground">Track balances song volume. Album preserves the album's relative levels. Untagged audio, radio and video stay unchanged.</p>
      </div>
    </div>
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    {saved && <p className="text-sm text-primary" role="status">Playback defaults saved.</p>}
    <Button className="min-h-11 justify-self-start" type="submit" disabled={!connected || pending || draft === null}>{pending ? "Saving…" : "Save preferences"}</Button>
  </form>;
}
