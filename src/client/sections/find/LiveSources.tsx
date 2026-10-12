import { useState } from "react";
import { Monitor, Radio, Square } from "lucide-react";
import { ChoiceGroup } from "@/components/ChoiceGroup";
import { MediaList, MediaRow } from "@/components/MediaRow";
import { PlayOnMenu } from "@/components/PlayOn";
import { SettingsRow, SettingsSection } from "@/components/SettingsRow";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { deviceId } from "@/session/device-id";
import { couchApp } from "@/session/native-context";
import { errorText, useSessionGate } from "@/session/session-context";
import type { CaptureKind, CaptureSource } from "../../../shared/capture";

const labels: Record<CaptureKind, string> = { "system-audio": "System audio", screen: "Screen & audio", microphone: "Microphone" };

export function LiveSources() {
  const { state, connected, startLive, endLive, localLiveSourceId, run } = useSessionGate();
  const [kind, setKind] = useState<CaptureKind>("system-audio");
  const [sources, setSources] = useState<CaptureSource[] | null>(null);
  const [sourceId, setSourceId] = useState("");
  const [pending, setPending] = useState(false);
  const [listing, setListing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const publications = state?.liveSources ?? [];
  const mine = publications.find(source => source.id === localLiveSourceId);
  const supported = !!navigator.mediaDevices?.getUserMedia;
  const displaySupported = !!navigator.mediaDevices?.getDisplayMedia;
  const choosesSource = !!couchApp?.captureSources && kind !== "microphone";
  const available = connected && !pending && !listing;

  const chooseSource = async () => {
    if (!couchApp?.captureSources || listing) return;
    setListing(true);
    setError(null);
    try {
      const next = await couchApp.captureSources();
      setSources(next);
      setSourceId(previous => next.some(source => source.id === previous) ? previous : next[0]?.id ?? "");
      if (!next.length) setError("No screens or windows are available. Allow Couch to record your screen in System Settings, then try again.");
    } catch (reason) { setError(errorText(reason)); }
    finally { setListing(false); }
  };

  const share = async () => {
    if (!available) return;
    setPending(true);
    setError(null);
    try { await startLive({ kind, ...(choosesSource ? { sourceId } : {}) }); }
    catch (reason) { setError(errorText(reason)); }
    finally { setPending(false); }
  };
  const stop = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    try { await endLive(); }
    catch (reason) { setError(errorText(reason)); }
    finally { setPending(false); }
  };

  return <section aria-label="Live devices" className="mb-8 space-y-6">
    <SettingsSection title="Share this device" description="Send sound or picture from this device to your other Couch devices.">
      {mine ? <SettingsRow label={mine.name} description="Sharing is active. Choose Play on below, then add devices in Where it plays.">
        <Button variant="outline" disabled={pending} onClick={() => void stop()}><Square aria-hidden="true" />{pending ? "Stopping…" : "Stop sharing"}</Button>
      </SettingsRow> : <>
        <SettingsRow label="Share">
          <ChoiceGroup label="What to share" value={kind} disabled={!available || !supported} onValueChange={value => { setKind(value); setError(null); }} options={Object.entries(labels).map(([value, label]) => ({ value: value as CaptureKind, label, disabled: value !== "microphone" && !displaySupported }))} />
        </SettingsRow>
        {choosesSource && <SettingsRow label="Screen or window" htmlFor={sources?.length ? "live-capture-source" : undefined} description={kind === "system-audio" ? "The screen stays private; only sound is sent." : "Shares the selected picture and system audio when available."}>
          {!!sources?.length && <Select value={sourceId} disabled={!available} onValueChange={setSourceId}>
            <SelectTrigger id="live-capture-source" className="w-full max-w-sm"><SelectValue placeholder="Choose a screen or window" /></SelectTrigger>
            <SelectContent>{sources.map(source => <SelectItem key={source.id} value={source.id}>{source.name}</SelectItem>)}</SelectContent>
          </Select>}
          <Button variant="ghost" disabled={!available} onClick={() => void chooseSource()}>{listing ? <><Spinner />Finding screens…</> : sources?.length ? "Refresh" : "Choose screen or window"}</Button>
        </SettingsRow>}
        <SettingsRow label="Start sharing" description={kind === "microphone" ? "Uses your default microphone or audio input. Playback on this device is off by default." : "Choose receiving devices after sharing starts. Playback on this device is off to prevent feedback."}>
          <Button disabled={!available || !supported || kind !== "microphone" && !displaySupported || choosesSource && !sourceId} onClick={() => void share()}>{pending ? <><Spinner />Starting…</> : "Start sharing"}</Button>
        </SettingsRow>
      </>}
      {!supported && <p className="text-sm text-muted-foreground">Open Couch over HTTPS or on localhost to share this device.</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </SettingsSection>
    {!!publications.length && <section aria-label="Live sources">
      <h2 className="mb-2 text-base font-medium">Live devices</h2>
      <MediaList>{publications.map(source => <MediaRow key={source.id} title={source.name} className="[&_[data-slot=item-actions]]:opacity-100" meta={<span className="flex items-center gap-2">{source.video ? <Monitor aria-hidden="true" className="size-4" /> : <Radio aria-hidden="true" className="size-4" />}{source.kind === "screen" && !source.audio ? "Screen without audio" : labels[source.kind]} · Live</span>}
        primary={{ label: "Play", disabled: !connected || source.kind !== "microphone" && source.deviceId === (state?.controlling ?? deviceId()), onClick: () => void run({ type: "playLive", sourceId: source.id }) }}
        actions={<PlayOnMenu title={source.name} disabled={!connected} excludeDeviceId={source.kind !== "microphone" ? source.deviceId : undefined} onPlay={deviceId => void run({ type: "playLive", sourceId: source.id, deviceId })} />} tvSecondaryActions />)}</MediaList>
    </section>}
  </section>;
}
