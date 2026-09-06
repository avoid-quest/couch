import { useEffect, useState, type FormEvent } from "react";
import type { GuideChannel } from "../shared/iptv";
import type { RecordingMapping } from "../shared/recordings";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { RecordingRequest } from "./RecordingsPanel";

type Setup = { configured: boolean; revision: number; mappings: RecordingMapping[] };
const empty = { endpoint: "", username: "", password: "", playbackUsername: "", playbackPassword: "", profileId: "" };
const fields = [
  ["endpoint", "Backend HTTPS address", "password"], ["username", "Recorder username", "text"], ["password", "Recorder password", "password"],
  ["playbackUsername", "Read-only playback username", "text"], ["playbackPassword", "Playback password", "password"], ["profileId", "Recording profile UUID", "text"],
] as const;

export function RecordingSettings({ request, channels, connected, onUpdated }: { request: RecordingRequest; channels: GuideChannel[]; connected: boolean; onUpdated: () => void }) {
  const [setup, setSetup] = useState<Setup | null>(null);
  const [credentials, setCredentials] = useState(empty);
  const [backendChannels, setBackendChannels] = useState<{ uuid: string; name: string }[]>([]);
  const [channelId, setChannelId] = useState(""); const [backendChannel, setBackendChannel] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null); const [notice, setNotice] = useState("");
  useEffect(() => {
    setCredentials(empty); setSetup(null); setBackendChannels([]);
    if (!connected) return;
    const controller = new AbortController();
    void request("setup", { signal: controller.signal }).then(response => response.json() as Promise<Setup>).then(value => {
      if (controller.signal.aborted) return;
      setSetup(value);
      if (value.configured) void request("channels", { signal: controller.signal }).then(response => response.json()).then(value => { if (!controller.signal.aborted) setBackendChannels(value.channels); }).catch(reason => { if (!controller.signal.aborted) setError(reason.message); });
    }).catch(reason => { if (!controller.signal.aborted) setError(reason.message); });
    return () => controller.abort();
  }, [request, connected, refresh]);
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null); setNotice("");
    try {
      const response = await request("setup", { method: "POST", body: JSON.stringify({ ...credentials, revision: setup?.revision ?? 0 }) });
      const value = await response.json();
      setSetup(previous => ({ configured: true, revision: value.revision, mappings: previous?.mappings ?? [] })); setBackendChannels(value.channels); setCredentials(empty);
      setNotice("Private accounts verified and saved on the TV. Map a guide channel below."); onUpdated();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save recording setup."); }
    finally { setBusy(false); }
  }
  async function map(event: FormEvent) {
    event.preventDefault(); const channel = channels.find(item => item.id === channelId); if (!channel || !setup) return;
    setBusy(true); setError(null); setNotice("");
    try {
      const response = await request("mappings", { method: "POST", body: JSON.stringify({ revision: setup.revision, channelId, sourceId: channel.sourceId, tvgId: channel.tvgId, backendChannel }) });
      const value = await response.json(); setSetup({ ...setup, revision: value.revision, mappings: value.mappings }); setNotice(`${channel.name} is mapped for recording.`); onUpdated();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not map this channel."); }
    finally { setBusy(false); }
  }
  return <section className="space-y-4" aria-label="Recording setup">
    <Button variant="outline" disabled={!connected || busy} onClick={() => setRefresh(value => value + 1)}>Reload setup</Button>
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    {notice && <p role="status" className="text-sm text-primary">{notice}</p>}
    <p className="text-sm text-muted-foreground">Use Tvheadend API 20 or newer with Basic authentication over HTTPS, or HTTP on loopback. Give the recorder basic DVR access. Give a separate playback account basic/view-all DVR access and streaming, with no administrator or manage-all rights.</p>
    <p className="text-sm text-muted-foreground">Verification briefly adds a disabled "Couch recording permission check" entry to Tvheadend. It cannot record. Couch removes it before saving setup. If verification or cleanup is interrupted, verify again with the same backend and accounts.</p>
    <form className="space-y-3" onSubmit={event => void save(event)}>
      <h3 className="font-medium">{setup?.configured ? "Replace private credentials" : "Connect a recording backend"}</h3>
      {fields.map(([key, label, type]) => <div key={key} className="space-y-1"><Label htmlFor={`recording-${key}`}>{label}</Label><Input id={`recording-${key}`} value={credentials[key]} type={type} autoComplete="off" spellCheck={false} autoCapitalize="none" required maxLength={key === "profileId" ? 32 : key === "endpoint" ? 2048 : key.toLowerCase().includes("password") ? 4096 : 200} disabled={!connected || busy || !setup} onChange={event => setCredentials(previous => ({ ...previous, [key]: event.target.value }))} /></div>)}
      <p className="text-sm text-muted-foreground">Account details stay on the TV and are never sent to the player in a shared queue. Existing jobs keep their backend, account and profile identities when you replace credentials.</p>
      <Button disabled={!connected || busy || !setup}>{busy ? "Saving…" : "Verify and save accounts"}</Button>
    </form>
    {setup?.configured && <form className="space-y-3 border-t pt-4" onSubmit={event => void map(event)}>
      <h3 className="font-medium">Map a guide channel</h3>
      <p className="text-sm text-muted-foreground">Select one of the channels on the current guide page and its exact backend channel. Channel names alone do not establish a match.</p>
      <div className="space-y-1"><Label htmlFor="recording-guide-channel">Couch guide channel</Label><Select value={channelId} onValueChange={setChannelId} disabled={!connected || busy}><SelectTrigger id="recording-guide-channel"><SelectValue placeholder="Select a guide channel" /></SelectTrigger><SelectContent>{channels.map(channel => <SelectItem key={channel.id} value={channel.id}>{channel.name} · {channel.tvgId}</SelectItem>)}</SelectContent></Select></div>
      <div className="space-y-1"><Label htmlFor="recording-backend-channel">Backend channel</Label><Select value={backendChannel} onValueChange={setBackendChannel} disabled={!connected || busy}><SelectTrigger id="recording-backend-channel"><SelectValue placeholder="Select a backend channel" /></SelectTrigger><SelectContent>{backendChannels.map(channel => <SelectItem key={channel.uuid} value={channel.uuid}>{channel.name} · {channel.uuid}</SelectItem>)}</SelectContent></Select></div>
      <Button disabled={!connected || busy || !channels.some(channel => channel.id === channelId) || !backendChannel}>Save channel mapping</Button>
      <ul className="space-y-2 text-sm">{setup.mappings.map(mapping => <li key={mapping.channelId} className="break-all rounded border p-2">{channels.find(channel => channel.id === mapping.channelId)?.name ?? "Saved guide channel"} · {mapping.tvgId}<br /><span className="text-muted-foreground">{mapping.backendChannel}</span></li>)}</ul>
    </form>}
  </section>;
}
