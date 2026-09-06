import { useEffect, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { UpdateState } from "../shared/updates";
import { ToolsSettings } from "./ToolsSettings";

type Props = { credentials: { origin: string; token: string }; connected: boolean };
const statuses: Record<UpdateState["status"], string> = { unavailable: "Updates unavailable", idle: "No newer release found", checking: "Checking for updates…", available: "Update available", downloading: "Downloading and verifying…", ready: "Verified download ready", failed: "Update operation failed" };
export function UpdatesSettings({ credentials, connected }: Props) {
  const [state, setState] = useState<UpdateState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const mutation = useRef<AbortController | null>(null);
  useEffect(() => { setState(null); setError(null); setLoadError(null); setPending(false); return () => mutation.current?.abort(); }, [credentials.origin, credentials.token, connected]);
  useEffect(() => {
    if (!connected || pending) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const response = await fetch(`${credentials.origin}/api/updates`, { headers: { Authorization: `Bearer ${credentials.token}` }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) });
        if (!response.ok) throw new Error();
        const result = await response.json() as UpdateState;
        if (!controller.signal.aborted) { setState(result); setLoadError(null); }
      } catch { if (!controller.signal.aborted) setLoadError("Could not load update status. Check the TV connection and try again."); }
      finally { if (!controller.signal.aborted) timer = setTimeout(() => void load(), 2_000); }
    };
    void load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [credentials.origin, credentials.token, connected, pending, refresh]);
  const update = async (path: string, body: unknown) => {
    if (!connected || pending) return;
    const controller = new AbortController(); mutation.current = controller;
    setPending(true); setError(null);
    try {
      const response = await fetch(`${credentials.origin}/api/updates/${path}`, { method: "POST", headers: { Authorization: `Bearer ${credentials.token}`, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) });
      const result = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok) { setError(result.error || "Could not start the update operation. Refresh its status and retry."); return; }
      setState(result);
    } catch { if (!controller.signal.aborted) setError("The request did not finish. Reconnect to see whether the TV accepted it."); }
    finally { if (!controller.signal.aborted) { setPending(false); setRefresh(value => value + 1); } if (mutation.current === controller) mutation.current = null; }
  };
  if (!connected) return <p role="status" className="text-muted-foreground">Connect to the TV to check updates.</p>;
  const problem = error ?? loadError;
  const busy = pending || !state || state.status === "checking" || state.status === "downloading";
  const candidate = state?.candidate;
  const canStage = state?.currentCheck && candidate && candidate.expiresAt > Date.now() && state.status !== "ready";
  return <div className="min-w-0 space-y-4">
    <p className="text-muted-foreground">Release settings apply to this TV installation. Checks and downloads keep playback running.</p>
    {state && <>
      <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2">
        <dt>Running version</dt><dd className="break-all">{state.running.version}</dd>
        <dt>Running commit</dt><dd className="break-all font-mono text-xs">{state.running.revision || "Unknown for this build"}</dd>
        <dt>Installation</dt><dd>Manual</dd>
        <dt>Last successful check</dt><dd>{state.lastSuccessfulCheck ? new Date(state.lastSuccessfulCheck).toLocaleString() : "No successful check yet"}</dd>
      </dl>
      <div className="space-y-2">
        <Label htmlFor="release-channel">Release channel</Label>
        <Select value={state.channel} disabled={busy || state.status === "unavailable"} onValueChange={channel => void update("channel", { channel })}>
          <SelectTrigger id="release-channel" className="min-h-11 w-full"><SelectValue>{state.channel === "stable" ? "Stable" : "Preview"}</SelectValue></SelectTrigger>
          <SelectContent><SelectItem value="stable">Stable</SelectItem><SelectItem value="preview">Preview</SelectItem></SelectContent>
        </Select>
        <p className="text-muted-foreground">Changing channels checks for a newer release. It does not install or downgrade Couch.</p>
      </div>
      <p role="status">{state.status === "idle" && !state.currentCheck ? "Waiting for a fresh check" : statuses[state.status]}</p>
      {candidate && <div className="space-y-2 rounded-lg border p-3">
        <p className="font-medium">{state.currentCheck ? "Available release" : "Last known release"}: <span className="break-all">{candidate.version}</span></p>
        <p className="break-all font-mono text-xs">{candidate.revision}</p>
        <p className="whitespace-pre-wrap break-words">{candidate.notes}</p>
        <p className="text-muted-foreground">Download size: {(candidate.bytes / 1024 / 1024).toFixed(1)} MB</p>
        {!state.currentCheck && <p className="text-muted-foreground">This release has not been confirmed by a successful current check.</p>}
        {state.status === "ready" && <p>The verified packages are ready on this TV.</p>}
      </div>}
      {state.error && <Alert variant="destructive"><AlertDescription>{state.error}</AlertDescription></Alert>}
    </>}
    {!state && !problem && <p role="status">Loading update status…</p>}
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" className="min-h-11" disabled={busy || state?.status === "unavailable"} onClick={() => void update("check", { check: true })}>Check now</Button>
      {candidate && state?.status !== "ready" && <Button className="min-h-11" disabled={busy || !canStage} onClick={() => void update("stage", { candidateId: candidate.id })}>Download update</Button>}
      {problem && <Button variant="outline" className="min-h-11" disabled={pending} onClick={() => { setError(null); setRefresh(value => value + 1); }}>Refresh status</Button>}
    </div>
    <p className="text-muted-foreground">Couch checks after startup and every 15 minutes. Keep the publishing Mac awake on the home network.</p>
    {problem && <Alert variant="destructive"><AlertDescription>{problem}</AlertDescription></Alert>}
    <ToolsSettings credentials={credentials} connected={connected} />
  </div>;
}
