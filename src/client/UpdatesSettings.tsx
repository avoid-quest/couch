import { useEffect, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { readUpdateRequest, saveUpdateRequest, clearUpdateRequest } from "./update-request";
import type { UpdateState } from "../shared/updates";
import { ToolsSettings } from "./ToolsSettings";

type Props = { credentials: { origin: string; token: string }; connected: boolean };
const statuses: Record<UpdateState["status"], string> = { unavailable: "Updates unavailable", idle: "No newer release found", checking: "Checking for updates…", available: "Update available", downloading: "Downloading and verifying…", ready: "Verified download ready", failed: "Update operation failed" };
export function UpdatesSettings({ credentials, connected }: Props) {
  const [state, setState] = useState<UpdateState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [retry, setRetry] = useState(() => readUpdateRequest(credentials.origin));
  const [confirming, setConfirming] = useState(false);
  const [interrupt, setInterrupt] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const mutation = useRef<AbortController | null>(null);
  useEffect(() => { setState(null); setError(null); setLoadError(null); setPending(false); setRetry(readUpdateRequest(credentials.origin)); return () => mutation.current?.abort(); }, [credentials.origin, credentials.token]);
  useEffect(() => { if (!connected && !retry && !state?.installation?.transaction) { setState(null); mutation.current?.abort(); } }, [connected]);
  useEffect(() => {
    if ((!connected && !retry && !state?.installation?.transaction) || pending) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const response = await fetch(`${credentials.origin}/api/updates`, { headers: { Authorization: `Bearer ${credentials.token}` }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) });
        if (!response.ok) throw new Error();
        const result = await response.json() as UpdateState;
        if (!controller.signal.aborted) {
          setState(result); setLoadError(null);
          const transaction = result.installation?.transaction;
          if (transaction && retry?.requestId === transaction.requestId && ["succeeded", "failed", "restored"].includes(transaction.phase)) { clearUpdateRequest(credentials.origin); setRetry(null); }
        }
      } catch { if (!controller.signal.aborted) setLoadError("Could not load update status. Check the TV connection and try again."); }
      finally { if (!controller.signal.aborted) timer = setTimeout(() => void load(), 2_000); }
    };
    void load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [credentials.origin, credentials.token, connected, pending, refresh, retry?.requestId]);
  const update = async (path: string, body: unknown) => {
    if ((!connected && path !== "install") || pending || mutation.current) return;
    const controller = new AbortController(); mutation.current = controller;
    setPending(true); setError(null);
    try {
      const response = await fetch(`${credentials.origin}/api/updates/${path}`, { method: "POST", headers: { Authorization: `Bearer ${credentials.token}`, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) });
      const result = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok) { setError(result.error || "Could not start the update operation. Refresh its status and retry."); return; }
      if (path === "install") setState(current => current ? { ...current, installation: { enabled: true, transaction: result.transaction } } : current);
      else setState(result);
    } catch { if (!controller.signal.aborted) setError("The request did not finish. Reconnect to see whether the TV accepted it."); }
    finally { if (!controller.signal.aborted) { setPending(false); setRefresh(value => value + 1); } if (mutation.current === controller) mutation.current = null; }
  };
  const transaction = state?.installation?.transaction;
  const installing = !!transaction && !["succeeded", "failed", "restored"].includes(transaction.phase);
  const install = async () => {
    try {
      const saved = retry ?? (state?.candidate ? saveUpdateRequest(credentials.origin, state.candidate, interrupt) : null);
      if (!saved) return;
      setRetry(saved); setConfirming(false);
      const { candidateId, requestId, confirmInterrupt } = saved;
      await update("install", { install: { candidateId, requestId, confirmInterrupt } });
    } catch { setError("Could not save this update's retry identity. Allow local storage before installing."); }
  };
  if (!connected && !retry && !transaction) return <p role="status" className="text-muted-foreground">Connect to the TV to check updates.</p>;
  const problem = error ?? loadError;
  const busy = !connected || pending || installing || !!retry || !state || state.status === "checking" || state.status === "downloading";
  const candidate = state?.candidate;
  const canStage = state?.currentCheck && candidate && candidate.expiresAt > Date.now() && state.status !== "ready";
  return <div className="min-w-0 space-y-4">
    <p className="text-muted-foreground">Release settings apply to this TV installation. Checks and downloads keep playback running.</p>
    {(retry || transaction) && <div className="space-y-2 rounded-lg border p-3" role="status">
      <p className="font-medium">{transaction?.phase === "succeeded" ? state?.running.version === transaction.version && state.running.revision === transaction.revision ? "Update installed and running" : "Update committed. Waiting for the matching running build." : transaction?.phase === "restored" ? "Previous release restored" : transaction?.phase === "operator-required" ? "Update needs SSH recovery" : transaction?.phase === "failed" ? "Update stopped before installation" : "Updating the TV"}</p>
      <p>{transaction?.version || retry?.version}</p>
      <p>{transaction?.phase || "Waiting for the TV to confirm this request"}</p>
      {transaction?.error && <p>{transaction.error}</p>}
      {!connected && <p>The TV is restarting or offline. This page will reconnect; keep it open.</p>}
      {transaction?.phase === "operator-required" && <p>From the administrator's SSH account, inspect <code>sudo couch-update status</code> and use the documented restoration command. Do not reinstall or delete the data directory.</p>}
      {retry && (!transaction || !installing && transaction.requestId !== retry.requestId) && <Button className="min-h-11" disabled={pending} onClick={() => void install()}>Retry same request</Button>}
    </div>}
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
    {state?.installation?.enabled && state.status === "ready" && !retry && !installing && <div className="space-y-2">
      {confirming ? <>
        <p>Install {candidate?.version} and restart the TV. Its viewing data will be backed up before package installation. Other remotes will disconnect.</p>
        <Label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={interrupt} onChange={event => setInterrupt(event.target.checked)} /> Stop playback if it is running</Label>
        <Button className="min-h-11" disabled={busy} onClick={() => void install()}>Install and restart</Button>
        <Button variant="outline" className="min-h-11" onClick={() => setConfirming(false)}>Cancel</Button>
      </> : <Button className="min-h-11" disabled={busy} onClick={() => setConfirming(true)}>Install update</Button>}
    </div>}
    <p className="text-muted-foreground">Couch checks after startup and every 15 minutes. Keep the publishing Mac awake on the home network.</p>
    {problem && <Alert variant="destructive"><AlertDescription>{problem}</AlertDescription></Alert>}
    <ToolsSettings credentials={credentials} connected={connected} />
  </div>;
}
