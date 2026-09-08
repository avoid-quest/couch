import { useEffect, useState, type FormEvent } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { RecordingRequest } from "./RecordingsPanel";

type Setup = { configured: boolean; revision: number; captureHours: number; retentionDays: number; storageGiB: number };
const empty = { endpoint: "", username: "", password: "" };
export function AntRecordingSettings({ request, connected, onUpdated }: { request: RecordingRequest; connected: boolean; onUpdated: () => void }) {
  const [setup, setSetup] = useState<Setup | null>(null), [credentials, setCredentials] = useState(empty);
  const [streamId, setStreamId] = useState(""), [title, setTitle] = useState("");
  const [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  useEffect(() => {
    setSetup(null); setCredentials(empty); setConfirmed(false);
    if (!connected) return;
    const controller = new AbortController();
    void request("ant/setup", { signal: controller.signal }).then(response => response.json()).then(value => { if (!controller.signal.aborted) setSetup(value); }).catch(reason => { if (!controller.signal.aborted) setError(reason.message); });
    return () => controller.abort();
  }, [request, connected]);
  async function submit(event: FormEvent, attach: boolean) {
    event.preventDefault(); if (!setup) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await request(`ant/${attach ? "attach" : "setup"}`, { method: "POST", body: JSON.stringify(attach ? { streamId, title, revision: setup.revision } : { ...credentials, ...setup, storageConfigured: confirmed }) });
      const value = await response.json();
      if (attach) { setStreamId(""); setTitle(""); setNotice(`${value.job.title} is attached. Open Recordings to play it on the TV.`); }
      else { setSetup(value); setCredentials(empty); setConfirmed(false); setNotice("Private access saved on the TV. Attaching a broadcast checks its access and playlist."); }
      onUpdated();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not update Ant recordings."); }
    finally { setBusy(false); }
  }
  return <section aria-label="Ant recordings" className="space-y-3 border-t pt-4">
    <h3 className="font-medium">Watch Ant recordings during capture</h3>
    <p className="text-sm text-muted-foreground">Ant manages capture and storage. Attach an existing broadcast here; guide scheduling continues to use Tvheadend.</p>
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    {notice && <p role="status" className="text-sm text-primary">{notice}</p>}
    <form onSubmit={event => void submit(event, false)} className="space-y-3">
      <p className="text-sm text-muted-foreground">Use a Basic-authenticated reverse proxy that protects the Ant application API and every HLS playlist and segment, over HTTPS or HTTP on loopback. Ant Community stream tokens do not enforce private access. Use a dedicated read-only proxy account.</p>
      {([['endpoint', 'Ant application URL', 'password'], ['username', 'Proxy username', 'text'], ['password', 'Proxy password', 'password']] as const).map(([key, label, type]) => <div key={key} className="space-y-1"><Label htmlFor={`ant-${key}`}>{label}</Label><Input id={`ant-${key}`} type={type} required autoComplete="off" spellCheck={false} autoCapitalize="none" maxLength={key === 'password' ? 4096 : key === 'endpoint' ? 2048 : 200} value={credentials[key]} disabled={!connected || busy || !setup} onChange={event => setCredentials({ ...credentials, [key]: event.target.value })} /></div>)}
      <p className="text-sm text-muted-foreground">For example, https://media.example/LiveApp. Existing recordings keep their endpoint and account when passwords change.</p>
      {([['captureHours', 'Maximum capture hours', 168], ['retentionDays', 'Retention days after planned end', 3650], ['storageGiB', 'Backend storage quota in GiB', 1048576]] as const).map(([key, label, max]) => <div key={key} className="space-y-1"><Label htmlFor={`ant-${key}`}>{label}</Label><Input id={`ant-${key}`} type="number" min={1} max={max} step={1} required value={setup?.[key] ?? ''} disabled={!connected || busy || !setup} onChange={event => setup && setSetup({ ...setup, [key]: Number(event.target.value) })} /></div>)}
      <Label className="flex items-start gap-2"><input type="checkbox" required checked={confirmed} disabled={!connected || busy || !setup} onChange={event => setConfirmed(event.target.checked)} /><span>The backend administrator enforces these capture, retention and storage limits, retains EVENT HLS after capture, and uses a new stream ID for every recording.</span></Label>
      <p className="text-sm text-muted-foreground">These are declared backend limits. Couch does not configure, verify or delete backend storage. It stops offering a recording after its declared retention window expires.</p>
      <Button disabled={!connected || busy || !setup || !confirmed}>Save Ant private access</Button>
    </form>
    {setup?.configured && <form onSubmit={event => void submit(event, true)} className="space-y-3 border-t pt-3">
      <div className="space-y-1"><Label htmlFor="ant-stream">Existing Ant broadcast ID</Label><Input id="ant-stream" required pattern="[A-Za-z0-9_-]+" maxLength={100} autoComplete="off" value={streamId} disabled={!connected || busy} onChange={event => setStreamId(event.target.value)} /></div>
      <div className="space-y-1"><Label htmlFor="ant-title">Recording title</Label><Input id="ant-title" maxLength={200} value={title} disabled={!connected || busy} onChange={event => setTitle(event.target.value)} /></div>
      <p className="text-sm text-muted-foreground">The broadcast must have started, have a finite planned end and retain its direct EVENT playlist. Stopping playback never stops capture.</p>
      <Button disabled={!connected || busy || !streamId}>Attach recording</Button>
    </form>}
  </section>;
}
