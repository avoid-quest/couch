import { useEffect, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { readUpdateRequest, saveUpdateRequest, clearUpdateRequest } from "./update-request";
import { verificationFailure, type UpdateState } from "../shared/updates";
import { ToolsSettings } from "./ToolsSettings";

type Props = { credentials: { origin: string; token: string }; connected: boolean; showTools?: boolean };
const statuses: Record<UpdateState["status"], string> = { unavailable: "Updates unavailable", idle: "No newer release found", checking: "Checking for updates…", available: "Update available", downloading: "Downloading and verifying…", ready: "Verified download ready", failed: "Update operation failed" };
export function UpdatesSettings({ credentials, connected, showTools = true }: Props) {
  const [state, setState] = useState<UpdateState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [retry, setRetry] = useState(() => readUpdateRequest(credentials.origin));
  const [confirming, setConfirming] = useState<false | "install" | "repair">(false);
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
        const response = await fetch(`${credentials.origin}/api/updates${retry ? `?requestId=${retry.requestId}` : ""}`, { headers: { Authorization: `Bearer ${credentials.token}` }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) });
        if (!response.ok) throw new Error();
        const result = await response.json() as UpdateState;
        if (!controller.signal.aborted) {
          setState(result); setLoadError(null);
          const transaction = result.installation?.requestedTransaction ?? result.installation?.transaction;
          if (transaction && retry?.requestId === transaction.requestId && ["succeeded", "failed", "restored", "operator-required"].includes(transaction.phase)) { clearUpdateRequest(credentials.origin); setRetry(null); }
        }
      } catch { if (!controller.signal.aborted) setLoadError("Could not load update status. Check the app connection and try again."); }
      finally { if (!controller.signal.aborted) timer = setTimeout(() => void load(), 2_000); }
    };
    void load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [credentials.origin, credentials.token, connected, pending, refresh, retry?.requestId]);
  const update = async (path: string, body: unknown) => {
    const maintenanceRequest = path === "install" || path === "repair";
    if ((!connected && !maintenanceRequest) || pending || mutation.current) return;
    const controller = new AbortController(); mutation.current = controller;
    setPending(true); setError(null);
    try {
      const response = await fetch(`${credentials.origin}/api/updates/${path}`, { method: "POST", headers: { Authorization: `Bearer ${credentials.token}`, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) });
      const result = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok) {
        if (maintenanceRequest && result.accepted === false) { clearUpdateRequest(credentials.origin); setRetry(null); }
        setError(result.error || "Could not start the update operation. Refresh its status and retry."); return;
      }
      if (maintenanceRequest) {
        if (result.transaction?.requestId === retry?.requestId && ["succeeded", "failed", "restored", "operator-required"].includes(result.transaction.phase)) { clearUpdateRequest(credentials.origin); setRetry(null); }
        setState(current => current ? { ...current, installation: { enabled: true, transaction: result.transaction } } : current);
      }
      else setState(result);
    } catch { if (!controller.signal.aborted) setError("The request did not finish. Reconnect to see whether the app accepted it."); }
    finally { if (!controller.signal.aborted) { setPending(false); setRefresh(value => value + 1); } if (mutation.current === controller) mutation.current = null; }
  };
  const transaction = state?.installation?.transaction;
  const installing = !!transaction && !["succeeded", "failed", "restored", "operator-required"].includes(transaction.phase);
  const install = async () => {
    try {
      const current = state?.installation?.current;
      const saved = retry ?? (confirming === "repair" && current ? saveUpdateRequest(credentials.origin, { id: current.candidateId, version: current.version, revision: current.revision }, interrupt, "repair-current") : state?.candidate ? saveUpdateRequest(credentials.origin, state.candidate, interrupt) : null);
      if (!saved) return;
      setRetry(saved); setConfirming(false);
      const { candidateId, requestId, confirmInterrupt } = saved;
      if (saved.intent === "repair-current") await update("repair", { repair: { expectedCurrentId: candidateId, requestId, confirmInterrupt, repairRuntime: saved.repairRuntime } });
      else await update("install", { install: { candidateId, requestId, confirmInterrupt } });
    } catch { setError("Could not save this update's retry identity. Allow local storage before installing."); }
  };
  const downloadAgain = async () => {
    clearUpdateRequest(credentials.origin); setRetry(null);
    if (state?.candidate) await update("stage", { candidateId: state.candidate.id });
  };
  if (!connected && !retry && !transaction) return <p role="status" className="text-muted-foreground">Connect to the app to check updates.</p>;
  const problem = error ?? loadError;
  const busy = !connected || pending || installing || !!retry || !state || state.status === "checking" || state.status === "downloading";
  const candidate = state?.candidate;
  const canStage = state?.currentCheck && candidate && (candidate.expiresAt === undefined || candidate.expiresAt > Date.now()) && state.status !== "ready";
  const canInstall = !busy && state?.installation?.enabled && state.currentCheck && state.status === "ready" && candidate && (candidate.expiresAt === undefined || candidate.expiresAt > Date.now());
  const phaseSentence = transaction && !installing ? null : transaction?.phase === "accepted" ? "The app accepted the update." : transaction?.phase === "preflight" ? "Checking storage and recovery material." : transaction?.phase === "quiescing" ? "Waiting for playback and downloads to stop." : transaction?.phase === "installing" ? "Installing the update." : transaction?.phase === "trial" || transaction?.phase === "committing" ? "Restarting into the new version. This page reconnects when the app is back." : transaction?.phase === "restoring" ? "Restoring the previous release." : "Waiting for the app to confirm this request.";
  const waitingStatus = !!state && (state.status === "checking" || state.status === "downloading");
  const statusText = state ? state.status === "idle" && !state.currentCheck ? "Waiting for a fresh check" : statuses[state.status] : null;
  return <div className="min-w-0 space-y-4">
    {(retry || transaction) && <Card role="status" className="min-w-0 gap-3 p-4 text-sm">
      <p className="font-medium">{transaction?.phase === "succeeded" ? state?.running.version === transaction.version && state.running.revision === transaction.revision ? transaction.intent === "repair-current" ? "Current release repaired and verified" : "Update installed and running" : "Update committed. The running build differs from this release." : transaction?.phase === "restored" ? transaction.intent === "repair-current" ? "Repair did not finish. Previous release restored" : "Previous release restored" : transaction?.phase === "operator-required" ? "Update needs SSH recovery" : transaction?.phase === "failed" ? transaction.intent === "repair-current" ? "Repair stopped before installation" : "Update stopped before installation" : transaction?.intent === "repair-current" ? "Repairing the current release" : "Updating Couch"}</p>
      <p>{transaction?.phase === "restored" ? transaction.restoredVersion : transaction?.version || retry?.version}</p>
      {phaseSentence && <p className="text-muted-foreground">{phaseSentence}</p>}
      {transaction?.progress && <p>{Math.floor(transaction.progress.received / 1024 / 1024)} / {Math.ceil(transaction.progress.total / 1024 / 1024)} MB repair download</p>}
      {transaction?.error && <p>{transaction.error}</p>}
      {!connected && <p>Couch is restarting or offline. This page will reconnect; keep it open.</p>}
      {transaction?.phase === "operator-required" && <p className="text-muted-foreground">From the administrator's SSH account, inspect the Couch journal before retrying and keep the data directory.</p>}
      {!installing && state?.candidate && verificationFailure(transaction?.error) && <div className="flex flex-wrap gap-2"><Button className="min-h-11" disabled={pending} onClick={() => void downloadAgain()}>Download again</Button></div>}
      {retry && (!transaction || !installing && transaction.requestId !== retry.requestId) && <div className="flex flex-wrap gap-2"><Button className="min-h-11" disabled={pending} onClick={() => void install()}>Retry same request</Button></div>}
    </Card>}
    {problem && <Alert variant="destructive"><AlertDescription className="flex flex-wrap items-center justify-between gap-2"><span>{problem}</span>{verificationFailure(problem) && state?.candidate ? <Button variant="outline" className="min-h-11" disabled={pending} onClick={() => void downloadAgain()}>Download again</Button> : <Button variant="outline" className="min-h-11" disabled={pending} onClick={() => { setError(null); setRefresh(value => value + 1); }}>Refresh status</Button>}</AlertDescription></Alert>}
    {!state && !problem && <Card className="min-w-0 gap-3 p-4 text-sm"><p role="status" className="flex items-center gap-2 text-muted-foreground"><Spinner className="size-3.5" />Loading update status…</p></Card>}
    {state && <Card className="min-w-0 gap-3 p-4 text-sm">
      <p role="status" className={waitingStatus ? "flex items-center gap-2" : undefined}>{waitingStatus && <Spinner className="size-3.5" />}{statusText}</p>
      {state.status === "downloading" && state.progress && <p role="status">{Math.floor(state.progress.received / 1024 / 1024)} / {Math.ceil(state.progress.total / 1024 / 1024)} MB downloaded</p>}
      {candidate && <div className="space-y-2">
        <p className="font-medium">{state.currentCheck ? "Available release" : "Last known release"}: <span className="break-all">{candidate.version}</span></p>
        <p className="whitespace-pre-wrap break-words">{candidate.notes}</p>
        <p className="text-muted-foreground">{candidate.bytes ? `Verified size: ${(candidate.bytes / 1024 / 1024).toFixed(1)} MB` : "The size and source commit will be verified after download."}</p>
        {!state.currentCheck && <p className="text-muted-foreground">This release has not been confirmed by a successful current check.</p>}
      </div>}
      {state.error && <Alert variant="destructive"><AlertDescription>{state.error}</AlertDescription></Alert>}
      {state.installation?.enabled && !installing && state.status !== "ready" && <p className="text-muted-foreground">Download a verified release to enable Install update.</p>}
      {!retry && !installing && confirming === "install" && <div className="space-y-2">
          <p>Install {candidate?.version} and restart Couch. Other remotes will disconnect; viewing data is preserved.</p>
          <Label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={interrupt} onChange={event => setInterrupt(event.target.checked)} /> Stop playback if it is running</Label>
          <div className="flex flex-wrap gap-2"><Button className="min-h-11" disabled={!canInstall} onClick={() => void install()}>Install and restart</Button><Button variant="outline" className="min-h-11" onClick={() => setConfirming(false)}>Cancel</Button></div>
      </div>}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" className="min-h-11" disabled={busy || state.status === "unavailable"} onClick={() => void update("check", { check: true })}>Check for updates</Button>
        {candidate && state.status !== "ready" && <Button className="min-h-11" disabled={busy || !canStage} onClick={() => void update("stage", { candidateId: candidate.id })}>Download update</Button>}
        {!retry && !installing && confirming !== "install" && <Button className="min-h-11" disabled={!canInstall} onClick={() => setConfirming("install")}>Install update</Button>}
      </div>
    </Card>}
    {state?.installationUnavailable && <p>{state.installationUnavailable}</p>}
    {state && !state.installationUnavailable && !state.installation?.enabled && <Card className="min-w-0 gap-2 p-4 text-sm">
      <p className="font-medium">Manual installation is not enabled on this installation.</p>
      <p className="text-muted-foreground">From the administrator's SSH account, follow the supported AppImage installation procedure, then reopen this page after Couch reconnects.</p>
    </Card>}
    {state && <Card className="min-w-0 gap-3 p-4 text-sm">
      <div className="space-y-2">
        <Label htmlFor="release-channel">Release channel</Label>
        <Select value={state.channel} disabled={busy || state.status === "unavailable"} onValueChange={channel => void update("channel", { channel })}>
          <SelectTrigger id="release-channel" className="min-h-11 w-full"><SelectValue>{state.channel === "stable" ? "Stable" : "Preview"}</SelectValue></SelectTrigger>
          <SelectContent><SelectItem value="stable">Stable</SelectItem><SelectItem value="preview">Preview</SelectItem></SelectContent>
        </Select>
        <p className="text-muted-foreground">Changing channels checks for a newer release. Switching to Stable cannot downgrade Couch.</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="update-policy">Install updates</Label>
        <Select value={state.policy} disabled={busy || state.status === "unavailable"} onValueChange={policy => void update("policy", { policy })}>
          <SelectTrigger id="update-policy" className="min-h-11 w-full"><SelectValue>{state.policy === "idle" ? "Auto when idle" : "Manual"}</SelectValue></SelectTrigger>
          <SelectContent><SelectItem value="manual">Manual</SelectItem><SelectItem value="idle" disabled={!state.installation?.enabled}>Auto when idle</SelectItem></SelectContent>
        </Select>
        <p className="text-muted-foreground">Auto downloads verified updates, then waits for ten continuous idle minutes. Pausing and radio reconnects keep waiting.</p>
        {state.policy === "idle" && <p role="status">{state.waiting || "Waiting for ten continuous idle minutes."}</p>}
      </div>
      <p className="text-xs text-muted-foreground">Running {state.running.version}, commit {state.running.revision || "unknown"} · Last successful check {state.lastSuccessfulCheck ? new Date(state.lastSuccessfulCheck).toLocaleString() : "none yet"}. Checks run at startup and every 15 minutes.</p>
    </Card>}
    {showTools && <ToolsSettings credentials={credentials} connected={connected} revision={transaction?.phase === "succeeded" ? transaction.updateId : undefined}>
      {state?.installation?.enabled && state.installation.repairAvailable === false && <p>Retained recovery is available through couch-recover. Keep the previous verified AppImage and backup; an old hosted download may expire.</p>}
      {state?.installation?.enabled && state.installation.current && !retry && !installing && <Card className="min-w-0 gap-3 p-4 text-sm">
        <p className="text-muted-foreground">Repair reinstalls enrolled Couch {state.installation.current.version}. It preserves preferences, pairings, media data, custom overrides and any newer staged release. It does not download a newer extractor.</p>
        {confirming === "repair" ? <>
          <p>Repair {state.installation.current.version} and restart Couch. Other remotes will disconnect; viewing data is backed up first. Missing authenticated current archives cause a failure.</p>
          <Label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={interrupt} onChange={event => setInterrupt(event.target.checked)} /> Stop playback if it is running</Label>
          <p className="text-muted-foreground">Repair reinstalls Couch files. The machine administrator maintains Debian host packages.</p>
          <div className="flex flex-wrap gap-2"><Button className="min-h-11" disabled={busy} onClick={() => void install()}>Repair and restart</Button><Button variant="outline" className="min-h-11" onClick={() => setConfirming(false)}>Cancel</Button></div>
          </> : <div className="flex flex-wrap gap-2"><Button className="min-h-11" disabled={busy} onClick={() => setConfirming("repair")}>Repair current release</Button></div>}
      </Card>}
    </ToolsSettings>}
  </div>;
}
