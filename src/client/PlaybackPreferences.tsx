import { useState, type FormEvent } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { WatchingProfile } from "../shared/library";
import type { Action, PlaybackPreferences as Preferences, ProfilePlaybackPreferences } from "../shared/protocol";

export function PlaybackPreferences({ profile, preferences, connected, onCommand }: {
  profile: WatchingProfile;
  preferences: Preferences;
  connected: boolean;
  onCommand: (action: Action) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState<ProfilePlaybackPreferences | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const values = draft ?? preferences.profile;
  const change = (patch: Partial<ProfilePlaybackPreferences>) => {
    setDraft({ ...values, ...patch });
    setSaved(false);
    setError(null);
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    setSaved(false);
    try {
      const ok = await onCommand({ type: "preferences", profileId: profile.id, preferences: {
        ...values, audioLanguage: values.audioLanguage.trim().toLowerCase(), subtitleLanguage: values.subtitleLanguage.trim().toLowerCase(),
      } });
      if (ok) {
        setDraft(null);
        setSaved(true);
      } else setError("Could not save preferences. Check the connection and current watching profile, then try again.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save playback preferences.");
    } finally { setPending(false); }
  };

  return <form className="grid gap-4" onSubmit={event => void save(event)}>
    <p className="text-sm text-muted-foreground">Languages, subtitle mode and speed belong to {profile.name}. Saved defaults apply to the next item and survive a restart.</p>
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="grid gap-2">
        <Label htmlFor="preferred-audio-language">Preferred audio language</Label>
        <Input id="preferred-audio-language" className="min-h-11" value={values.audioLanguage} disabled={!connected || pending} placeholder="Automatic" maxLength={3} pattern="[A-Za-z]{2,3}" title="A two- or three-letter language code, or empty for automatic" autoComplete="off" autoCapitalize="none" spellCheck={false} aria-describedby="playback-language-help" onChange={event => change({ audioLanguage: event.target.value })} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="preferred-subtitle-language">Preferred subtitle language</Label>
        <Input id="preferred-subtitle-language" className="min-h-11" value={values.subtitleLanguage} disabled={!connected || pending} placeholder="Automatic" maxLength={3} pattern="[A-Za-z]{2,3}" title="A two- or three-letter language code, or empty for automatic" autoComplete="off" autoCapitalize="none" spellCheck={false} aria-describedby="playback-language-help" onChange={event => change({ subtitleLanguage: event.target.value })} />
      </div>
      <p id="playback-language-help" className="text-sm text-muted-foreground sm:col-span-2">Use a language code such as en, eng, it or ita. Leave empty for automatic selection.</p>
      <div className="grid gap-2">
        <Label htmlFor="preferred-subtitle-mode">Default subtitles</Label>
        <Select value={values.subtitles} disabled={!connected || pending} onValueChange={value => change({ subtitles: value as "auto" | "off" })}>
          <SelectTrigger id="preferred-subtitle-mode" className="min-h-11 w-full"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="auto" className="min-h-11">Automatic</SelectItem><SelectItem value="off" className="min-h-11">Off</SelectItem></SelectContent>
        </Select>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="preferred-playback-speed">Default playback speed</Label>
        <Select value={String(values.speed)} disabled={!connected || pending} onValueChange={value => change({ speed: Number(value) })}>
          <SelectTrigger id="preferred-playback-speed" className="min-h-11 w-full"><SelectValue /></SelectTrigger>
          <SelectContent>{[0.5, 0.75, 1, 1.25, 1.5, 2].map(speed => <SelectItem key={speed} value={String(speed)} className="min-h-11">{speed === 1 ? "Normal" : `${speed}×`}</SelectItem>)}</SelectContent>
        </Select>
      </div>
    </div>
    <p className="text-sm text-muted-foreground">TV audio delay is {Number(preferences.device.audioDelay.toFixed(2))} seconds and applies to every profile. Change it during playback. Subtitle delay applies only to the current item.</p>
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    {saved && <p className="text-sm text-primary" role="status">Preferences saved for {profile.name}.</p>}
    <Button className="min-h-11 justify-self-start" type="submit" disabled={!connected || pending || draft === null}>{pending ? "Saving…" : "Save preferences"}</Button>
  </form>;
}
