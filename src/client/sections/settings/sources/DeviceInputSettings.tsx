import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Square } from "lucide-react";
import { ChoiceGroup } from "@/components/ChoiceGroup";
import { SettingsRow, SettingsSection } from "@/components/SettingsRow";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { couchApp } from "@/session/native-context";
import { errorText, useSessionGate } from "@/session/session-context";
import type { CaptureKind, CaptureSource } from "../../../../shared/capture";
import type { LiveVideoQuality } from "../../../../shared/live-input";

const labels: Record<CaptureKind, string> = { "system-audio": "System audio", screen: "Screen", microphone: "Microphone or audio input" };

export function DeviceInputSettings({ onAdded, title }: { onAdded?: () => void; title?: string }) {
  const { state, connected, startLive, endLive, liveAudioInputs, localLiveSourceId } = useSessionGate();
  const navigate = useNavigate();
  const [kind, setKind] = useState<CaptureKind>("screen");
  const [sources, setSources] = useState<CaptureSource[] | null>(null);
  const [sourceId, setSourceId] = useState("");
  const [inputs, setInputs] = useState<MediaDeviceInfo[] | null>(null);
  const [audioDeviceId, setAudioDeviceId] = useState("default");
  const [videoQuality, setVideoQuality] = useState<LiveVideoQuality>("1080p");
  const [includeAudio, setIncludeAudio] = useState(true);
  const [pending, setPending] = useState(false);
  const [listing, setListing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // What to turn on in the system's settings, once capturing failed without it. A check that
  // ends after the choice changed answers for the previous kind, so it shows only for that one.
  const [blocked, setBlocked] = useState<{ kind: CaptureKind; text: string } | null>(null);
  const mine = state?.liveSources?.find(source => source.id === localLiveSourceId);
  const supported = !!navigator.mediaDevices?.getUserMedia;
  const displaySupported = !!navigator.mediaDevices?.getDisplayMedia;
  const choosesSource = !!couchApp?.captureSources && kind !== "microphone";
  const available = connected && !pending && !listing;
  const checkAccess = async () => {
    const text = await couchApp?.captureAccess?.(kind).catch(() => null);
    setBlocked(text ? { kind, text } : null);
  };
  // Returning from the system's settings clears the row once access is on.
  useEffect(() => {
    if (!blocked) return;
    const recheck = () => void checkAccess();
    addEventListener("focus", recheck);
    return () => removeEventListener("focus", recheck);
  }, [blocked, kind]);

  const chooseSource = async () => {
    if (!couchApp?.captureSources || !available) return;
    setListing(true); setError(null);
    try {
      const next = await couchApp.captureSources();
      setSources(next);
      setSourceId(previous => next.some(source => source.id === previous) ? previous : "");
      if (!next.length) { setError("No screens or windows are available. Allow Couch to record your screen in System Settings, then try again."); await checkAccess(); }
    } catch (reason) { setError(errorText(reason)); await checkAccess(); }
    finally { setListing(false); }
  };
  const chooseInput = async () => {
    if (!available) return;
    setListing(true); setError(null);
    try {
      const next = await liveAudioInputs();
      setInputs(next);
      setAudioDeviceId(previous => next.some(input => input.deviceId === previous) ? previous : "default");
      if (!next.length) setError("No audio inputs are available. Connect a microphone or audio interface and try again.");
    } catch (reason) { setError(errorText(reason)); await checkAccess(); }
    finally { setListing(false); }
  };
  const share = async () => {
    if (!available) return;
    setPending(true); setError(null);
    try {
      await startLive({ kind, videoQuality, includeAudio, ...(choosesSource ? { sourceId } : {}), ...(kind === "microphone" && audioDeviceId !== "default" ? { audioDeviceId } : {}) });
      onAdded?.();
      void navigate({ to: "/find" });
    }
    catch (reason) { setError(errorText(reason)); await checkAccess(); }
    finally { setPending(false); }
  };
  const stop = async () => {
    if (pending) return;
    setPending(true); setError(null);
    try { await endLive(); }
    catch (reason) { setError(errorText(reason)); }
    finally { setPending(false); }
  };

  // Capture runs with this device's authority, so a paired phone's Remote never drives it on a TV.
  return <SettingsSection title={title} description="Add this device's screen or sound as a source for everyone on this Couch." data-tv-local-only>
    {mine ? <SettingsRow label={mine.name} description="Available in Find while this device is sharing.">
      <Button variant="outline" disabled={pending} onClick={() => void stop()}><Square aria-hidden="true" />{pending ? "Stopping…" : "Stop sharing"}</Button>
    </SettingsRow> : <>
      <SettingsRow label="Input">
        <ChoiceGroup label="What to share" value={kind} disabled={!available || !supported} onValueChange={value => { setKind(value); setError(null); setBlocked(null); }} options={Object.entries(labels).map(([value, label]) => ({ value: value as CaptureKind, label, disabled: value !== "microphone" && !displaySupported }))} />
      </SettingsRow>
      {choosesSource && <SettingsRow label="Screen or window" htmlFor={sources?.length ? "live-capture-source" : undefined} description={kind === "system-audio" ? "Only sound is sent. The picture stays private." : "Choose the picture to share."}>
        {!!sources?.length && <Select value={sourceId} disabled={!available} onValueChange={setSourceId}>
          <SelectTrigger id="live-capture-source" className="w-full max-w-sm"><SelectValue placeholder="Choose a screen or window" /></SelectTrigger>
          <SelectContent data-tv-local-only>{sources.map(source => <SelectItem key={source.id} value={source.id}>{source.name}</SelectItem>)}</SelectContent>
        </Select>}
        <Button variant="ghost" disabled={!available} onClick={() => void chooseSource()}>{listing ? <><Spinner />Finding screens…</> : sources?.length ? "Refresh" : "Choose screen or window"}</Button>
      </SettingsRow>}
      {kind === "microphone" && <SettingsRow label="Audio input" htmlFor="live-audio-input" description="Choose a microphone or connected audio interface. Access is requested to list input names.">
        <Select value={audioDeviceId} disabled={!available} onValueChange={setAudioDeviceId}>
          <SelectTrigger id="live-audio-input" className="w-full max-w-sm"><SelectValue /></SelectTrigger>
          <SelectContent data-tv-local-only><SelectItem value="default">System default</SelectItem>{inputs?.filter(input => input.deviceId !== "default").map((input, index) => <SelectItem key={input.deviceId} value={input.deviceId}>{input.label || `Audio input ${index + 1}`}</SelectItem>)}</SelectContent>
        </Select>
        <Button variant="ghost" disabled={!available || !supported} onClick={() => void chooseInput()}>{listing ? <><Spinner />Finding inputs…</> : inputs ? "Refresh inputs" : "Choose audio input"}</Button>
      </SettingsRow>}
      {kind === "screen" && <>
        <SettingsRow label="Picture quality" htmlFor="live-video-quality" description="Up to 30 fps. Lower resolutions use less bandwidth and processing.">
          <Select value={videoQuality} disabled={!available} onValueChange={value => setVideoQuality(value as LiveVideoQuality)}>
            <SelectTrigger id="live-video-quality" className="w-full max-w-sm"><SelectValue /></SelectTrigger>
            <SelectContent data-tv-local-only><SelectItem value="720p">720p · Less bandwidth</SelectItem><SelectItem value="1080p">1080p · Balanced</SelectItem><SelectItem value="original">Original resolution</SelectItem></SelectContent>
          </Select>
        </SettingsRow>
        <SettingsRow label="Include system audio" htmlFor="live-include-audio" description="Shares the computer's audio mix when available, even when sharing one window.">
          <Switch id="live-include-audio" checked={includeAudio} disabled={!available} onCheckedChange={setIncludeAudio} />
        </SettingsRow>
      </>}
      <SettingsRow label="Share with Couch" description="Available in Find until you stop sharing.">
        <Button disabled={!available || !supported || kind !== "microphone" && !displaySupported || choosesSource && !sourceId} onClick={() => void share()}>{pending ? <><Spinner />Adding…</> : "Add source"}</Button>
        {pending && <Button variant="ghost" onClick={() => void endLive().catch(reason => setError(errorText(reason)))}>Cancel</Button>}
      </SettingsRow>
    </>}
    {blocked?.kind === kind && !mine && <SettingsRow label="Allow access" description={blocked.text}>
      <Button variant="outline" onClick={() => void couchApp?.openCaptureSettings?.(kind).catch(reason => setError(errorText(reason)))}>Open settings</Button>
    </SettingsRow>}
    {!supported && <p className="text-sm text-muted-foreground">Open Couch over HTTPS or on localhost to share this device.</p>}
    {!displaySupported && supported && <p className="text-sm text-muted-foreground">This browser can share audio inputs. Use the desktop app to share a screen or system audio.</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </SettingsSection>;
}
