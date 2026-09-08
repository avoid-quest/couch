import { profileDisplayName } from "./profile-name";
import { useState, type FormEvent } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { WatchingProfile } from "../shared/library";
import type { Action, PlaybackPreferences as Preferences, ProfilePlaybackPreferences, ReplayGainMode } from "../shared/protocol";
import { playbackLanguages } from "./playback-languages";

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
      } else setError("Could not save preferences. Check the connection and current watching profile, then try again.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save playback preferences.");
    } finally { setPending(false); }
  };

  return <form className="grid gap-4" onSubmit={event => void save(event)}>
    <div className="space-y-1"><p className="font-medium break-words">Watching profile: {profileDisplayName(profile)}</p><p className="text-sm text-muted-foreground">Saved defaults apply when the next item starts and survive a restart. This item keeps its current choices. Choose who is watching from your name in the navigation. Stop playback before switching people.</p></div>
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="grid gap-2">
        <Label htmlFor="preferred-audio-language">Preferred audio language</Label>
        <Select value={values.audioLanguage || "automatic"} disabled={!connected || pending} onValueChange={value => change({ audioLanguage: value === "automatic" ? "" : value })}>
          <SelectTrigger id="preferred-audio-language" className="min-h-11 w-full"><SelectValue /></SelectTrigger>
          <SelectContent>{playbackLanguages(values.audioLanguage).map(({ code, name }) => <SelectItem key={code} value={code || "automatic"} className="min-h-11">{name}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="preferred-subtitle-language">Preferred subtitle language</Label>
        <Select value={values.subtitleLanguage || "automatic"} disabled={!connected || pending} onValueChange={value => change({ subtitleLanguage: value === "automatic" ? "" : value })}>
          <SelectTrigger id="preferred-subtitle-language" className="min-h-11 w-full"><SelectValue /></SelectTrigger>
          <SelectContent>{playbackLanguages(values.subtitleLanguage).map(({ code, name }) => <SelectItem key={code} value={code || "automatic"} className="min-h-11">{name}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <p className="text-sm text-muted-foreground sm:col-span-2">The TV chooses a matching language when the item offers it. Automatic lets the player choose.</p>
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
          <SelectContent>{[...new Set([0.5, 0.75, 1, 1.25, 1.5, 2, values.speed])].sort((a, b) => a - b).map(speed => <SelectItem key={speed} value={String(speed)} className="min-h-11">{speed === 1 ? "Normal" : `${speed}×`}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="grid gap-2 sm:col-span-2">
        <Label htmlFor="preferred-replaygain">Default music ReplayGain</Label>
        <Select value={values.replayGain} disabled={!connected || pending} onValueChange={value => change({ replayGain: value as ReplayGainMode })}>
          <SelectTrigger id="preferred-replaygain" className="min-h-11 w-full"><SelectValue /></SelectTrigger>
          <SelectContent>{["off", "track", "album"].map(mode => <SelectItem key={mode} value={mode} className="min-h-11">{mode[0]!.toUpperCase() + mode.slice(1)}</SelectItem>)}</SelectContent>
        </Select>
        <p className="text-sm text-muted-foreground">Track uses each song's gain tags. Album keeps the album's relative levels and falls back to Track. Untagged music stays unchanged. Radio and video keep their normal level.</p>
        <p className="text-sm text-muted-foreground">Tagged peaks limit amplification, with no added preamp. Missing classic peaks prevent boosts; some formats also lose attenuation. R128 without peaks and inaccurate tags can still clip.</p>
      </div>
    </div>
    <p className="text-sm text-muted-foreground">TV audio delay is {Number(preferences.device.audioDelay.toFixed(2))} seconds and applies to every profile. Change it during playback. Subtitle delay applies only to the current item.</p>
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    {saved && <p className="text-sm text-primary" role="status">Preferences saved for {profileDisplayName(profile)}.</p>}
    <Button className="min-h-11 justify-self-start" type="submit" disabled={!connected || pending || draft === null}>{pending ? "Saving…" : "Save preferences"}</Button>
  </form>;
}
