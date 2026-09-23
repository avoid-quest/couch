import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch, type ApiCredentials } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { readUpdateRequest, saveUpdateRequest, clearUpdateRequest } from "../../../update-request";
import { verificationFailure, type UpdateState } from "../../../../shared/updates";

type Props = { credentials: ApiCredentials; connected: boolean; target?: "this app" | "selected host" };
const statuses: Record<UpdateState["status"], string> = { unavailable: "Updates unavailable", idle: "No newer release found", checking: "Checking for updates…", available: "Update available", downloading: "Downloading and verifying…", ready: "Verified download ready", failed: "Update operation failed" };
export function UpdatesSettings({ credentials, connected, target = "selected host" }: Props) {
  const [state, setState] = useState<UpdateState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [retry, setRetry] = useState(() => readUpdateRequest(credentials.origin));
  const [confirming, setConfirming] = useState<false | "install" | "repair">(false);
  const [interrupt, setInterrupt] = useState(false);
  const queryKey = ["updates", credentials.origin, credentials.token, retry?.requestId];
  const updates = useQuery({
    queryKey,
    enabled: connected || !!retry,
    queryFn: () => apiFetch(credentials, `/api/updates${retry ? `?requestId=${retry.requestId}` : ""}`).then(response => response.json() as Promise<UpdateState>),
    refetchInterval: 2_000,
    refetchIntervalInBackground: false,
    retry: false,
  });
  useEffect(() => { setState(null); setError(null); setPending(false); setRetry(readUpdateRequest(credentials.origin)); }, [credentials.origin, credentials.token]);
  useEffect(() => {
    if (!updates.data) return;
    setState(updates.data);
    const transaction = updates.data.installation?.requestedTransaction ?? updates.data.installation?.transaction;
    if (transaction && retry?.requestId === transaction.requestId && ["succeeded", "failed", "restored", "operator-required"].includes(transaction.phase)) {
      clearUpdateRequest(credentials.origin); setRetry(null);
    }
  }, [credentials.origin, retry?.requestId, updates.data, updates.dataUpdatedAt]);
  async function update(path: string, body: unknown) {
    const maintenanceRequest = path === "install" || path === "repair";
    if ((!connected && !maintenanceRequest) || pending) return;
    setPending(true); setError(null);
    try {
      const response = await apiFetch(credentials, `/api/updates/${path}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const result = await response.json() as { accepted?: boolean; error?: string; transaction?: NonNullable<UpdateState["installation"]>["transaction"] };
      if (!response.ok) {
        if (maintenanceRequest && result.accepted === false) { clearUpdateRequest(credentials.origin); setRetry(null); }
        setError(result.error || "Could not start the update operation. Refresh its status and retry."); return;
      }
      if (maintenanceRequest) {
        const transaction = result.transaction;
        const terminalRequest = transaction?.requestId === retry?.requestId && !!transaction && ["succeeded", "failed", "restored", "operator-required"].includes(transaction.phase);
        if (terminalRequest) { clearUpdateRequest(credentials.origin); setRetry(null); }
        setState(current => current ? { ...current, installation: { enabled: true, transaction: transaction ?? null } } : current);
      }
      else setState(result as UpdateState);
      await updates.refetch();
    } catch { setError("The request did not finish. Reconnect to see whether the app accepted it."); }
    finally { setPending(false); }
  }
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
  if (!connected && !retry && !transaction) return <p role="status" className="text-muted-foreground">Connect to {target} to check updates.</p>;
  const problem = error ?? (updates.error ? `Could not load update status for ${target}. Check the connection and try again.` : null);
  const busy = !connected || pending || installing || !!retry || !state || state.status === "checking" || state.status === "downloading";
  const candidate = state?.candidate;
  const canStage = state?.currentCheck && candidate && (candidate.expiresAt === undefined || candidate.expiresAt > Date.now()) && state.status !== "ready";
  const canInstall = !busy && state?.installation?.enabled && state.currentCheck && state.status === "ready" && candidate && (candidate.expiresAt === undefined || candidate.expiresAt > Date.now());
  const phaseSentence = transaction && !installing ? null : transaction?.phase === "accepted" ? "The app accepted the update." : transaction?.phase === "preflight" ? "Checking storage and recovery material." : transaction?.phase === "quiescing" ? "Waiting for playback and downloads to stop." : transaction?.phase === "installing" ? "Installing the update." : transaction?.phase === "trial" || transaction?.phase === "committing" ? "Restarting into the new version. This page reconnects when the app is back." : transaction?.phase === "restoring" ? "Restoring the previous release." : "Waiting for the app to confirm this request.";
  const waitingStatus = !!state && (state.status === "checking" || state.status === "downloading");
  const statusText = state ? state.status === "idle" && !state.currentCheck ? "Waiting for a fresh check" : statuses[state.status] : null;
  return <div className="min-w-0 space-y-4">
    <p className="text-sm text-muted-foreground">Updates and recovery for {target}. Running {state?.running.version ?? "unknown version"}{state?.running.revision ? `, commit ${state.running.revision}` : ""}.</p>
    {state && <Card className="min-w-0 gap-4 p-4 text-sm">
      <div className="space-y-2"><Label htmlFor="release-channel">Release channel</Label>
        <Select value={state.channel} disabled={busy || state.status === "unavailable"} onValueChange={value => void update("channel", { channel: value })}>
          <SelectTrigger id="release-channel" className="min-h-11 w-full"><SelectValue>{state.channel === "stable" ? "Stable" : "Preview"}</SelectValue></SelectTrigger>
          <SelectContent><SelectItem value="stable">Stable</SelectItem><SelectItem value="preview">Preview</SelectItem></SelectContent>
        </Select>
      </div>
      <div className="space-y-2"><Label htmlFor="update-policy">Install updates</Label>
        <Select value={state.policy} disabled={busy || state.status === "unavailable"} onValueChange={value => void update("policy", { policy: value })}>
          <SelectTrigger id="update-policy" className="min-h-11 w-full"><SelectValue>{state.policy === "idle" ? "Auto when idle" : "Manual"}</SelectValue></SelectTrigger>
          <SelectContent><SelectItem value="manual">Manual</SelectItem><SelectItem value="idle" disabled={!state.installation?.enabled}>Auto when idle</SelectItem></SelectContent>
        </Select>
        {state.policy === "idle" && <p role="status">{state.waiting || "Waiting until Couch is idle."}</p>}
      </div>
      <p className="text-xs text-muted-foreground">Last check: {state.lastSuccessfulCheck ? new Date(state.lastSuccessfulCheck).toLocaleString() : "none yet"}.</p>
    </Card>}
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
    {problem && <Alert variant="destructive"><AlertDescription className="flex flex-wrap items-center justify-between gap-2"><span>{problem}</span>{verificationFailure(problem) && state?.candidate ? <Button variant="outline" className="min-h-11" disabled={pending} onClick={() => void downloadAgain()}>Download again</Button> : <Button variant="outline" className="min-h-11" disabled={pending} onClick={() => { setError(null); void updates.refetch(); }}>Refresh status</Button>}</AlertDescription></Alert>}
    {!state && !problem && <Card className="min-w-0 gap-3 p-4 text-sm"><p role="status" className="flex items-center gap-2 text-muted-foreground"><Spinner className="size-3.5" />Loading update status…</p></Card>}
    {state && <Card className="min-w-0 gap-3 p-4 text-sm">
      <p role="status" className={waitingStatus ? "flex items-center gap-2" : undefined}>{waitingStatus && <Spinner className="size-3.5" />}{statusText}</p>
      {state.status === "downloading" && state.progress && <p role="status">{Math.floor(state.progress.received / 1024 / 1024)} / {Math.ceil(state.progress.total / 1024 / 1024)} MB downloaded</p>}
      {candidate && <div className="space-y-2">
        <p className="font-medium">{state.currentCheck ? "Available release" : "Last known release"}: <span className="break-all">{candidate.version}</span></p>
        <p className="whitespace-pre-wrap break-words">{candidate.notes}</p>
      </div>}
      {state.error && <Alert variant="destructive"><AlertDescription>{state.error}</AlertDescription></Alert>}
      {!retry && !installing && confirming === "install" && <div className="space-y-2">
          <p>Install {candidate?.version} on {target} and restart it. Its remotes will disconnect; viewing data is preserved.</p>
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
    {state?.installation?.enabled && state.installation.repairAvailable && state.installation.current && !retry && !installing && <Card className="min-w-0 gap-3 p-4 text-sm">
      <p className="text-muted-foreground">Reinstall Couch {state.installation.current.version} without changing your data.</p>
      {confirming === "repair" ? <>
        <p>Repair {state.installation.current.version} on {target} and restart it. Its remotes will disconnect.</p>
        <Label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={interrupt} onChange={event => setInterrupt(event.target.checked)} /> Stop playback if it is running</Label>
        <div className="flex flex-wrap gap-2"><Button className="min-h-11" disabled={busy} onClick={() => void install()}>Repair and restart</Button><Button variant="outline" className="min-h-11" onClick={() => setConfirming(false)}>Cancel</Button></div>
        </> : <div className="flex flex-wrap gap-2"><Button className="min-h-11" disabled={busy} onClick={() => setConfirming("repair")}>Repair current release</Button></div>}
    </Card>}
  </div>;
}
